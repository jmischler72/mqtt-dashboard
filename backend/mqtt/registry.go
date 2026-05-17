package mqtt

import (
	"database/sql"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"mqtt-dashboard/models"
)

// BrokerRegistry manages multiple concurrent MQTT clients, one per broker.
type BrokerRegistry struct {
	mu              sync.RWMutex
	clients         map[string]*MQTTManager // brokerID → manager
	defaultBrokerID string
	db              *sql.DB
}

func NewRegistry(db *sql.DB) *BrokerRegistry {
	return &BrokerRegistry{
		clients: make(map[string]*MQTTManager),
		db:      db,
	}
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
	mgr.Subscribe("#", func(topic string, payload []byte) { //nolint
		r.writeHistory(brokerID, topic, payload)
	})
	return err
}

// writeHistory persists an incoming MQTT message to mqtt_history, skipping $SYS/ topics.
func (r *BrokerRegistry) writeHistory(brokerID, topic string, payload []byte) {
	if strings.HasPrefix(topic, "$SYS/") {
		return
	}
	if r.db == nil {
		return
	}
	r.db.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES (?, ?, ?)`, //nolint
		brokerID, topic, string(payload))
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
func (r *BrokerRegistry) Publish(brokerID, topic string, payload []byte) error {
	mgr, ok := r.GetClient(brokerID)
	if !ok {
		return fmt.Errorf("broker %q not found", brokerID)
	}
	return mgr.Publish(topic, payload)
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
