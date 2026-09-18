package ws

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	mqttclient "mqtt-dashboard/mqtt"
)

// WSMessage is sent over WebSocket to clients.
type WSMessage struct {
	PanelID           string `json:"panel_id,omitempty"`
	SourcePanelID     string `json:"source_panel_id,omitempty"`
	SourcePanelTitle  string `json:"source_panel_title,omitempty"`
	SourceDashboardID string `json:"source_dashboard_id,omitempty"`
	BrokerID          string `json:"broker_id"`
	Topic             string `json:"topic"`
	Payload           string `json:"payload"`
	Timestamp         string `json:"timestamp"`
	QoS               int    `json:"qos"`
	Retained          bool   `json:"retained"`
}

// SubscribeRequest is the message a client sends to subscribe to or unsubscribe from topics on a broker.
type SubscribeRequest struct {
	Action   string   `json:"action,omitempty"` // "subscribe" (default) or "unsubscribe"
	PanelID  string   `json:"panel_id"`
	BrokerID string   `json:"broker_id"`
	Topics   []string `json:"topics"`
}

type Client struct {
	id            string
	panelID       string
	brokerID      string
	topics        []string
	send          chan WSMessage
	hub           *Hub
	mu            sync.Mutex
	closed        bool
	panelSubs     map[string]map[brokerTopic]struct{}
	subscriptions map[brokerTopic]map[string]struct{}
}

// SetPanelID sets the client's associated panel ID safely under lock.
func (c *Client) SetPanelID(panelID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.panelID = panelID
}

// Send non-blockingly sends a message to the client, stamped with the client's panelID.
// It returns false if the client is already closed or if the channel buffer is full.
func (c *Client) Send(msg WSMessage) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return false
	}
	msg.PanelID = c.panelID
	select {
	case c.send <- msg:
		return true
	default:
		return false
	}
}

// Close marks the client as closed and safely closes the send channel once.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
}


// brokerTopic is a composite key for routing: one broker × one topic.
type brokerTopic struct {
	brokerID string
	topic    string
}

type panelMeta struct {
	title       string
	dashboardID string
	found       bool
}

type Hub struct {
	mu             sync.RWMutex
	clients        map[string]*Client
	registry       BrokerSubscriber
	db             *sql.DB
	panelMetaCache sync.Map // panelID -> panelMeta

	// (brokerID, topic) → set of clientIDs
	topicClients map[brokerTopic]map[string]struct{}
	// (brokerID, topic) → stable MQTT handler reference
	topicHandlers map[brokerTopic]mqttclient.MessageHandler
}

func NewHub(registry BrokerSubscriber, db ...*sql.DB) *Hub {
	var database *sql.DB
	if len(db) > 0 {
		database = db[0]
	}
	return &Hub{
		clients:       make(map[string]*Client),
		registry:      registry,
		db:            database,
		topicClients:  make(map[brokerTopic]map[string]struct{}),
		topicHandlers: make(map[brokerTopic]mqttclient.MessageHandler),
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	slog.Debug("ws client registered", "client_id", c.id)
	h.clients[c.id] = c
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	slog.Debug("ws client unregistered", "client_id", c.id)

	delete(h.clients, c.id)
	c.Close()

	c.mu.Lock()
	defer c.mu.Unlock()

	for bt := range c.subscriptions {
		h.removeTopicClient(bt, c.id)
	}
	c.subscriptions = nil
	c.panelSubs = nil

	for _, topic := range c.topics {
		h.removeTopicClient(brokerTopic{c.brokerID, topic}, c.id)
	}
}

func (h *Hub) Subscribe(c *Client, brokerID string, topics []string) {
	panelID := c.panelID
	if panelID == "" {
		panelID = "default"
	}
	h.SubscribePanel(c, panelID, brokerID, topics)
}

func (h *Hub) SubscribePanel(c *Client, panelID, brokerID string, topics []string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.panelSubs == nil {
		c.panelSubs = make(map[string]map[brokerTopic]struct{})
	}
	if c.subscriptions == nil {
		c.subscriptions = make(map[brokerTopic]map[string]struct{})
	}

	if panelID == "" {
		panelID = "default"
	}

	// 1. Remove old subscriptions for this panelID
	if oldBTs, ok := c.panelSubs[panelID]; ok {
		for bt := range oldBTs {
			if panels, exists := c.subscriptions[bt]; exists {
				delete(panels, panelID)
				if len(panels) == 0 {
					delete(c.subscriptions, bt)
					h.removeTopicClient(bt, c.id)
				}
			}
		}
		delete(c.panelSubs, panelID)
	}

	// 2. Add new subscriptions for this panelID
	c.panelSubs[panelID] = make(map[brokerTopic]struct{})
	for _, topic := range topics {
		bt := brokerTopic{brokerID, topic}
		c.panelSubs[panelID][bt] = struct{}{}

		if _, ok := c.subscriptions[bt]; !ok {
			c.subscriptions[bt] = make(map[string]struct{})
			if _, exists := h.topicClients[bt]; !exists {
				h.topicClients[bt] = make(map[string]struct{})
				t := topic
				bid := brokerID
				handler := h.buildMQTTHandler(bid, t)
				h.topicHandlers[bt] = handler
				if err := h.registry.Subscribe(bid, t, handler); err != nil {
					delete(h.topicHandlers, bt)
					slog.Error("ws subscribe mqtt", "broker_id", bid, "topic", t, "err", err)
				}
			}
			h.topicClients[bt][c.id] = struct{}{}
		}
		c.subscriptions[bt][panelID] = struct{}{}
	}
}

func (h *Hub) UnsubscribePanel(c *Client, panelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	c.mu.Lock()
	defer c.mu.Unlock()

	if c.panelSubs == nil {
		return
	}
	if oldBTs, ok := c.panelSubs[panelID]; ok {
		for bt := range oldBTs {
			if panels, exists := c.subscriptions[bt]; exists {
				delete(panels, panelID)
				if len(panels) == 0 {
					delete(c.subscriptions, bt)
					h.removeTopicClient(bt, c.id)
				}
			}
		}
		delete(c.panelSubs, panelID)
	}
}

func (h *Hub) resolvePanelMeta(panelID string) (string, string) {
	if val, ok := h.panelMetaCache.Load(panelID); ok {
		meta := val.(panelMeta)
		if !meta.found {
			return "", ""
		}
		return meta.title, meta.dashboardID
	}
	if h.db == nil {
		return "", ""
	}
	var title, dashID string
	err := h.db.QueryRow(`SELECT title, dashboard_id FROM dashboard_layouts WHERE id = ?`, panelID).Scan(&title, &dashID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			h.panelMetaCache.Store(panelID, panelMeta{found: false})
		}
		return "", ""
	}
	h.panelMetaCache.Store(panelID, panelMeta{title: title, dashboardID: dashID, found: true})
	return title, dashID
}

// InvalidatePanelMeta removes a cached panel metadata entry.
func (h *Hub) InvalidatePanelMeta(panelID string) {
	h.panelMetaCache.Delete(panelID)
}

func (h *Hub) buildMQTTHandler(brokerID, topic string) mqttclient.MessageHandler {
	return func(msgTopic string, payload []byte, qos byte, retained bool, sourcePanelID string) {
		key := brokerTopic{brokerID, topic}
		h.mu.RLock()
		clientIDs := make([]string, 0, len(h.topicClients[key]))
		for cid := range h.topicClients[key] {
			clientIDs = append(clientIDs, cid)
		}
		clients := make([]*Client, 0, len(clientIDs))
		for _, cid := range clientIDs {
			if c, ok := h.clients[cid]; ok {
				clients = append(clients, c)
			}
		}
		h.mu.RUnlock()

		isRetained := retained || h.registry.IsRetained(brokerID, msgTopic)
		if sourcePanelID == "" && isRetained {
			sourcePanelID = h.registry.GetRetainedPanel(brokerID, msgTopic)
		}

		var sourceTitle, sourceDashboard string
		if sourcePanelID != "" {
			sourceTitle, sourceDashboard = h.resolvePanelMeta(sourcePanelID)
		}

		// The broker only sets the retained flag when replaying to a NEW subscriber,
		// so live deliveries arrive with retained=false even for topics that hold a
		// retained value. Consult the registry's tracked set so the flag is accurate
		// regardless of when this client subscribed.
		msg := WSMessage{
			BrokerID:          brokerID,
			Topic:             msgTopic,
			Payload:           string(payload),
			Timestamp:         time.Now().UTC().Format(time.RFC3339Nano),
			QoS:               int(qos),
			Retained:          isRetained,
			SourcePanelID:     sourcePanelID,
			SourcePanelTitle:  sourceTitle,
			SourceDashboardID: sourceDashboard,
		}
		for _, c := range clients {
			c.Send(msg)
		}
	}
}

func (h *Hub) removeTopicClient(key brokerTopic, clientID string) {
	if cids, ok := h.topicClients[key]; ok {
		delete(cids, clientID)
		if len(cids) == 0 {
			delete(h.topicClients, key)
			if handler, ok := h.topicHandlers[key]; ok {
				h.registry.Unsubscribe(key.brokerID, key.topic, handler)
				delete(h.topicHandlers, key)
			}
		}
	}
}

func marshalMessage(msg WSMessage) []byte {
	b, _ := json.Marshal(msg)
	return b
}

var _ = marshalMessage // used in handler.go
