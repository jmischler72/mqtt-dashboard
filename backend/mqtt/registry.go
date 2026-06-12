package mqtt

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"

	"mqtt-dashboard/models"
)

// BrokerRegistry manages multiple concurrent MQTT clients, one per broker.
type BrokerRegistry struct {
	mu              sync.RWMutex
	clients         map[string]*MQTTManager // brokerID → manager
	defaultBrokerID string
	db              *sql.DB
	statsCache      *StatsCache
	saveSysTopics   atomic.Bool

	historyMu            sync.RWMutex
	historyQueue         chan historyRecord
	historyStopCh        chan struct{}
	historyWorkerStarted bool
	historyWorkerWG      sync.WaitGroup

	// retainedMu guards retained, which tracks (brokerID, topic) pairs the broker
	// currently holds a retained message for. The broker only sets the retained
	// flag when replaying to a NEW subscriber, so live deliveries to existing
	// subscribers arrive with retained=false; this set lets the WS hub stamp the
	// retained flag regardless of subscription timing.
	retainedMu sync.RWMutex
	retained   map[retainedKey]struct{}
}

type retainedKey struct {
	brokerID string
	topic    string
}

// SetSaveSysTopics controls whether $SYS/* messages are persisted to history.
func (r *BrokerRegistry) SetSaveSysTopics(v bool) {
	r.saveSysTopics.Store(v)
}

// markRetained records or clears whether the broker holds a retained message for
// a topic. Per the MQTT spec, publishing a retained message with an empty payload
// deletes the stored retained message, so callers pass hasPayload=false to clear.
func (r *BrokerRegistry) markRetained(brokerID, topic string, hasPayload bool) {
	key := retainedKey{brokerID: brokerID, topic: topic}
	r.retainedMu.Lock()
	defer r.retainedMu.Unlock()
	if hasPayload {
		r.retained[key] = struct{}{}
	} else {
		delete(r.retained, key)
	}
}

// IsRetained reports whether the broker currently holds a retained message for
// the given concrete topic.
func (r *BrokerRegistry) IsRetained(brokerID, topic string) bool {
	r.retainedMu.RLock()
	defer r.retainedMu.RUnlock()
	_, ok := r.retained[retainedKey{brokerID: brokerID, topic: topic}]
	return ok
}

type historyRecord struct {
	brokerID string
	topic    string
	payload  string
}

const historyQueueSize = 1024

func NewRegistry(db *sql.DB) *BrokerRegistry {
	return &BrokerRegistry{
		clients:       make(map[string]*MQTTManager),
		db:            db,
		statsCache:    NewStatsCache(),
		historyQueue:  make(chan historyRecord, historyQueueSize),
		historyStopCh: make(chan struct{}),
		retained:      make(map[retainedKey]struct{}),
	}
}

// StartHistoryWriter launches a single worker that serializes history writes.
func (r *BrokerRegistry) StartHistoryWriter() {
	if r.db == nil {
		return
	}

	r.historyMu.Lock()
	if r.historyWorkerStarted {
		r.historyMu.Unlock()
		return
	}
	r.historyWorkerStarted = true
	r.historyWorkerWG.Add(1)
	r.historyMu.Unlock()

	slog.Info("history writer started", "queue_size", cap(r.historyQueue))
	go func() {
		defer r.historyWorkerWG.Done()
		for {
			select {
			case rec := <-r.historyQueue:
				r.insertHistoryRecord(rec)
			case <-r.historyStopCh:
				// Drain pending records to avoid losing buffered history during shutdown.
				for {
					select {
					case rec := <-r.historyQueue:
						r.insertHistoryRecord(rec)
					default:
						slog.Info("history writer stopped")
						return
					}
				}
			}
		}
	}()
}

// StopHistoryWriter asks the worker to stop and blocks until buffered messages are drained.
func (r *BrokerRegistry) StopHistoryWriter() {
	r.historyMu.Lock()
	started := r.historyWorkerStarted
	if started {
		r.historyWorkerStarted = false
		close(r.historyStopCh)
	}
	r.historyMu.Unlock()

	if !started {
		return
	}

	r.historyWorkerWG.Wait()
}

// AddBroker creates a new MQTTManager for the broker, connects it, and stores it.
// The manager is stored even on connection failure so its ERROR status is visible.
func (r *BrokerRegistry) AddBroker(broker models.MQTTBroker) error {
	slog.Info("adding broker", "broker", broker.Name, "id", broker.ID)
	mgr := NewManager()
	err := mgr.Connect(broker)
	r.mu.Lock()
	r.clients[broker.ID] = mgr
	r.mu.Unlock()
	// Subscribe '#' for history capture. MQTTManager prevents overlapping MQTT
	// subscriptions, so this is safe alongside specific panel topic subscriptions.
	brokerID := broker.ID
	mgr.Subscribe("#", func(topic string, payload []byte, _ byte, retained bool) { //nolint
		if retained {
			r.markRetained(brokerID, topic, len(payload) > 0)
		}
		r.writeHistory(brokerID, topic, payload)
	})
	// '$SYS/*' is not matched by '#', so subscribe explicitly for broker stats
	// and history capture.
	mgr.Subscribe("$SYS/#", func(topic string, payload []byte, _ byte, _ bool) { //nolint
		r.parseSysStats(brokerID, topic, payload)
		r.writeHistory(brokerID, topic, payload)
	})
	return err
}

// writeHistory persists an incoming MQTT message to mqtt_history.
func (r *BrokerRegistry) writeHistory(brokerID, topic string, payload []byte) {
	if r.db == nil {
		return
	}
	if strings.HasPrefix(topic, "$SYS/") && !r.saveSysTopics.Load() {
		return
	}

	rec := historyRecord{brokerID: brokerID, topic: topic, payload: string(payload)}

	r.historyMu.RLock()
	started := r.historyWorkerStarted
	r.historyMu.RUnlock()

	if !started {
		r.insertHistoryRecord(rec)
		return
	}

	select {
	case r.historyQueue <- rec:
	default:
		// Drop the message rather than writing directly from the MQTT callback
		// goroutine, which would bypass the single-writer serialisation and risk
		// concurrent SQLite writes. $SYS metrics repeat every few seconds so
		// losing one sample is acceptable.
		slog.Warn("history queue full, dropping message", "broker_id", brokerID, "topic", topic)
	}
}

func (r *BrokerRegistry) insertHistoryRecord(rec historyRecord) {
	if _, err := r.db.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES (?, ?, ?)`,
		rec.brokerID, rec.topic, rec.payload); err != nil {
		slog.Error("write history failed", "broker_id", rec.brokerID, "topic", rec.topic, "err", err)
	}
}

// RemoveBroker gracefully disconnects and removes a broker client.
func (r *BrokerRegistry) RemoveBroker(id string) {
	slog.Info("removing broker", "id", id)
	r.mu.Lock()
	defer r.mu.Unlock()
	if mgr, ok := r.clients[id]; ok {
		mgr.Disconnect()
		delete(r.clients, id)
	}
	r.statsCache.ClearStats(id)
	if r.defaultBrokerID == id {
		r.defaultBrokerID = ""
	}
}

// GetClient returns the MQTTManager for a broker ID.
func (r *BrokerRegistry) GetClient(id string) (*MQTTManager, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	mgr, ok := r.clients[id]
	return mgr, ok
}

// SetDefault sets the default broker ID used as fallback when no broker_id is specified.
func (r *BrokerRegistry) SetDefault(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.defaultBrokerID = id
}

// DefaultBrokerID returns the current default broker ID.
func (r *BrokerRegistry) DefaultBrokerID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.defaultBrokerID
}

// Status returns the connection status of a specific broker.
func (r *BrokerRegistry) Status(id string) string {
	if mgr, ok := r.GetClient(id); ok {
		return mgr.Status()
	}
	return "DISCONNECTED"
}

// StatusError returns the last connection error message for a broker, or empty string.
func (r *BrokerRegistry) StatusError(id string) string {
	if mgr, ok := r.GetClient(id); ok {
		return mgr.ConnectError()
	}
	return ""
}

// AllStatuses returns a map of brokerID → status for all registered clients.
func (r *BrokerRegistry) AllStatuses() map[string]string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]string, len(r.clients))
	for id, mgr := range r.clients {
		result[id] = mgr.Status()
	}
	return result
}

// Publish sends a message to a topic on the specified broker.
func (r *BrokerRegistry) Publish(brokerID, topic string, qos byte, retain bool, payload []byte) error {
	mgr, ok := r.GetClient(brokerID)
	if !ok {
		return fmt.Errorf("broker %q not found", brokerID)
	}
	if err := mgr.Publish(topic, qos, retain, payload); err != nil {
		return err
	}
	// Track retained state for our own publishes so the WS hub can stamp the
	// retained flag immediately, without waiting for a broker replay on the next
	// fresh subscribe. An empty-payload retained publish clears the stored message.
	if retain {
		r.markRetained(brokerID, topic, len(payload) > 0)
	}
	return nil
}

// Subscribe registers a handler for a topic on the specified broker.
func (r *BrokerRegistry) Subscribe(brokerID, topic string, handler MessageHandler) error {
	mgr, ok := r.GetClient(brokerID)
	if !ok {
		return fmt.Errorf("broker %q not found", brokerID)
	}
	return mgr.Subscribe(topic, handler)
}

// Unsubscribe removes a handler for a topic on the specified broker.
func (r *BrokerRegistry) Unsubscribe(brokerID, topic string, handler MessageHandler) {
	if mgr, ok := r.GetClient(brokerID); ok {
		mgr.Unsubscribe(topic, handler)
	}
}

// GetStats returns the cached broker statistics.
func (r *BrokerRegistry) GetStats(brokerID string) *models.BrokerStats {
	return r.statsCache.GetStats(brokerID)
}

// parseSysStats extracts and updates broker statistics from $SYS topic messages.
func (r *BrokerRegistry) parseSysStats(brokerID, topic string, payload []byte) {
	if !strings.HasPrefix(topic, "$SYS/broker/") {
		return
	}

	payloadStr := string(payload)

	updateInt64Stat := func(statKey string) {
		var value int64
		if n, err := fmt.Sscanf(payloadStr, "%d", &value); err == nil && n == 1 {
			r.statsCache.UpdateStat(brokerID, statKey, value)
		}
	}

	updateIntStat := func(statKey string) {
		var value int
		if n, err := fmt.Sscanf(payloadStr, "%d", &value); err == nil && n == 1 {
			r.statsCache.UpdateStat(brokerID, statKey, value)
		}
	}

	// Map $SYS topics to stat keys
	switch {
	case strings.HasSuffix(topic, "$SYS/broker/version"):
		r.statsCache.UpdateStat(brokerID, "version", payloadStr)
	case strings.HasSuffix(topic, "$SYS/broker/uptime"):
		updateInt64Stat("uptime")
	case strings.HasSuffix(topic, "$SYS/broker/clients/connected"):
		updateIntStat("clients_connected")
	case strings.HasSuffix(topic, "$SYS/broker/messages/sent"):
		updateInt64Stat("messages_sent")
	case strings.HasSuffix(topic, "$SYS/broker/messages/received"):
		updateInt64Stat("messages_received")
	case strings.HasSuffix(topic, "$SYS/broker/load/messages/sent/5min"):
		updateInt64Stat("messages_5m_sent")
	case strings.HasSuffix(topic, "$SYS/broker/load/messages/received/5min"):
		updateInt64Stat("messages_5m_received")
	case strings.HasSuffix(topic, "$SYS/broker/heap/current"):
		updateInt64Stat("memory_used")
	case strings.HasSuffix(topic, "$SYS/broker/heap/maximum"):
		updateInt64Stat("memory_max")
	}
}
