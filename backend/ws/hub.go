package ws

import (
	"encoding/json"
	"log/slog"
	"sync"

	mqttclient "mqtt-dashboard/mqtt"
)

// WSMessage is sent over WebSocket to clients.
type WSMessage struct {
	PanelID  string `json:"panel_id"`
	BrokerID string `json:"broker_id"`
	Topic    string `json:"topic"`
	Payload  string `json:"payload"`
}

// SubscribeRequest is the message a client sends to subscribe to topics on a broker.
type SubscribeRequest struct {
	PanelID  string   `json:"panel_id"`
	BrokerID string   `json:"broker_id"`
	Topics   []string `json:"topics"`
}

type Client struct {
	id       string
	panelID  string
	brokerID string
	topics   []string
	send     chan WSMessage
	hub      *Hub
}

// brokerTopic is a composite key for routing: one broker × one topic.
type brokerTopic struct {
	brokerID string
	topic    string
}

type Hub struct {
	mu       sync.RWMutex
	clients  map[string]*Client
	registry *mqttclient.BrokerRegistry

	// (brokerID, topic) → set of clientIDs
	topicClients map[brokerTopic]map[string]struct{}
	// (brokerID, topic) → stable MQTT handler reference
	topicHandlers map[brokerTopic]mqttclient.MessageHandler
}

func NewHub(registry *mqttclient.BrokerRegistry) *Hub {
	return &Hub{
		clients:       make(map[string]*Client),
		registry:      registry,
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
	close(c.send)

	for _, topic := range c.topics {
		h.removeTopicClient(brokerTopic{c.brokerID, topic}, c.id)
	}
}

func (h *Hub) Subscribe(c *Client, brokerID string, topics []string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Remove old subscriptions for this client
	for _, t := range c.topics {
		h.removeTopicClient(brokerTopic{c.brokerID, t}, c.id)
	}
	c.brokerID = brokerID
	c.topics = topics

	for _, topic := range topics {
		key := brokerTopic{brokerID, topic}
		if _, ok := h.topicClients[key]; !ok {
			h.topicClients[key] = make(map[string]struct{})
			t := topic
			bid := brokerID
			handler := h.buildMQTTHandler(bid, t)
			h.topicHandlers[key] = handler
			if err := h.registry.Subscribe(bid, t, handler); err != nil {
				delete(h.topicHandlers, key)
				slog.Error("ws subscribe mqtt", "broker_id", bid, "topic", t, "err", err)
			}
		}
		h.topicClients[key][c.id] = struct{}{}
	}
}

func (h *Hub) buildMQTTHandler(brokerID, topic string) mqttclient.MessageHandler {
	return func(msgTopic string, payload []byte) {
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

		msg := WSMessage{
			BrokerID: brokerID,
			Topic:    msgTopic,
			Payload:  string(payload),
		}
		for _, c := range clients {
			msg.PanelID = c.panelID
			select {
			case c.send <- msg:
			default:
				// Drop message if channel is full
			}
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
