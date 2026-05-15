package ws

import (
	"encoding/json"
	"log"
	"sync"

	mqttclient "mqtt-dashboard/mqtt"
)

// Message sent over WebSocket to clients.
type WSMessage struct {
	PanelID string `json:"panel_id"`
	Topic   string `json:"topic"`
	Payload string `json:"payload"`
}

// SubscribeRequest is the first message a client sends after connecting.
type SubscribeRequest struct {
	PanelID string   `json:"panel_id"`
	Topics  []string `json:"topics"`
}

type Client struct {
	id      string
	panelID string
	topics  []string
	send    chan WSMessage
	hub     *Hub
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]*Client // clientID → Client
	mqtt    *mqttclient.MQTTManager

	// topic → list of clientIDs
	topicClients map[string]map[string]struct{}
	// topic -> stable MQTT handler reference
	topicHandlers map[string]mqttclient.MessageHandler
}

func NewHub(mqtt *mqttclient.MQTTManager) *Hub {
	return &Hub{
		clients:       make(map[string]*Client),
		mqtt:          mqtt,
		topicClients:  make(map[string]map[string]struct{}),
		topicHandlers: make(map[string]mqttclient.MessageHandler),
	}
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c.id] = c
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.clients, c.id)
	close(c.send)

	for _, topic := range c.topics {
		h.removeTopicClient(topic, c.id)
	}
}

func (h *Hub) Subscribe(c *Client, topics []string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Remove old subscriptions for this client
	for _, t := range c.topics {
		h.removeTopicClient(t, c.id)
	}
	c.topics = topics

	for _, topic := range topics {
		if _, ok := h.topicClients[topic]; !ok {
			h.topicClients[topic] = make(map[string]struct{})
			// Subscribe to MQTT only once per unique topic
			t := topic // capture
			handler := h.buildMQTTHandler(t)
			h.topicHandlers[t] = handler
			if err := h.mqtt.Subscribe(t, handler); err != nil {
				delete(h.topicHandlers, t)
				log.Printf("ws: subscribe mqtt topic %q: %v", t, err)
			}
		}
		h.topicClients[topic][c.id] = struct{}{}
	}
}

func (h *Hub) buildMQTTHandler(topic string) mqttclient.MessageHandler {
	return func(msgTopic string, payload []byte) {
		h.mu.RLock()
		clientIDs := make([]string, 0)
		for cid := range h.topicClients[topic] {
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
			Topic:   msgTopic,
			Payload: string(payload),
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

func (h *Hub) removeTopicClient(topic, clientID string) {
	if cids, ok := h.topicClients[topic]; ok {
		delete(cids, clientID)
		if len(cids) == 0 {
			delete(h.topicClients, topic)
			// Unsubscribe from MQTT when no clients remain
			if handler, ok := h.topicHandlers[topic]; ok {
				h.mqtt.Unsubscribe(topic, handler)
				delete(h.topicHandlers, topic)
			}
		}
	}
}

func marshalMessage(msg WSMessage) []byte {
	b, _ := json.Marshal(msg)
	return b
}

var _ = marshalMessage // used in handler.go
