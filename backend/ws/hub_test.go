package ws

import (
	"encoding/json"
	"sync"
	"testing"

	mqttclient "mqtt-dashboard/mqtt"

	"github.com/google/uuid"
)

func TestMarshalMessage_EncodesJSON(t *testing.T) {
	raw := marshalMessage(WSMessage{
		PanelID:  "panel-1",
		BrokerID: "b1",
		Topic:    "sensor/temp",
		Payload:  "42",
	})

	var got WSMessage
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal marshaled message: %v", err)
	}
	if got.PanelID != "panel-1" || got.BrokerID != "b1" || got.Topic != "sensor/temp" || got.Payload != "42" {
		t.Fatalf("unexpected marshaled payload: %+v", got)
	}
	if got.Timestamp != "" {
		t.Fatalf("expected empty timestamp when not set, got %q", got.Timestamp)
	}
}

// mockBrokerSub implements BrokerSubscriber for hub tests.
type mockBrokerSub struct {
	mu           sync.Mutex
	subscribed   map[string]mqttclient.MessageHandler
	unsubscribed []string
	defaultID    string
	subscribeErr error
}

func newMockBrokerSub() *mockBrokerSub {
	return &mockBrokerSub{
		subscribed: make(map[string]mqttclient.MessageHandler),
	}
}

func (m *mockBrokerSub) Subscribe(brokerID, topic string, handler mqttclient.MessageHandler) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.subscribed[brokerID+":"+topic] = handler
	return m.subscribeErr
}

func (m *mockBrokerSub) Unsubscribe(brokerID, topic string, _ mqttclient.MessageHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := brokerID + ":" + topic
	delete(m.subscribed, key)
	m.unsubscribed = append(m.unsubscribed, key)
}

func (m *mockBrokerSub) DefaultBrokerID() string {
	return m.defaultID
}

func (m *mockBrokerSub) trigger(brokerID, topic string, payload []byte) {
	m.mu.Lock()
	h, ok := m.subscribed[brokerID+":"+topic]
	m.mu.Unlock()
	if ok {
		h(topic, payload)
	}
}

func newTestClient(hub *Hub) *Client {
	return &Client{
		id:   uuid.New().String(),
		hub:  hub,
		send: make(chan WSMessage, 16),
	}
}

func TestRegister_AddsClient(t *testing.T) {
	reg := newMockBrokerSub()
	hub := NewHub(reg)

	c := newTestClient(hub)
	hub.Register(c)

	hub.mu.RLock()
	_, ok := hub.clients[c.id]
	hub.mu.RUnlock()

	if !ok {
		t.Error("client should be in hub.clients after Register")
	}
}

func TestUnregister_RemovesClient(t *testing.T) {
	reg := newMockBrokerSub()
	hub := NewHub(reg)

	c := newTestClient(hub)
	hub.Register(c)
	hub.Unregister(c)

	hub.mu.RLock()
	_, ok := hub.clients[c.id]
	hub.mu.RUnlock()

	if ok {
		t.Error("client should not be in hub.clients after Unregister")
	}
}

func TestSubscribe_CallsRegistrySubscribe(t *testing.T) {
	reg := newMockBrokerSub()
	hub := NewHub(reg)

	c := newTestClient(hub)
	hub.Register(c)
	hub.Subscribe(c, "broker1", []string{"test/topic"})

	reg.mu.Lock()
	_, ok := reg.subscribed["broker1:test/topic"]
	reg.mu.Unlock()

	if !ok {
		t.Error("expected registry.Subscribe to be called with broker1:test/topic")
	}
}

func TestSubscribe_FanOutMessage(t *testing.T) {
	reg := newMockBrokerSub()
	hub := NewHub(reg)

	c := newTestClient(hub)
	c.panelID = "panel1"
	hub.Register(c)
	hub.Subscribe(c, "broker1", []string{"sensor/temp"})

	// Trigger message via mock registry
	reg.trigger("broker1", "sensor/temp", []byte("42"))

	select {
	case msg := <-c.send:
		if msg.Topic != "sensor/temp" {
			t.Errorf("msg.Topic = %q, want 'sensor/temp'", msg.Topic)
		}
		if msg.Payload != "42" {
			t.Errorf("msg.Payload = %q, want '42'", msg.Payload)
		}
		if msg.BrokerID != "broker1" {
			t.Errorf("msg.BrokerID = %q, want 'broker1'", msg.BrokerID)
		}
		if msg.Timestamp == "" {
			t.Errorf("msg.Timestamp should be set")
		}
	default:
		t.Fatal("expected message in client send channel")
	}
}

func TestUnregister_UnsubscribesFromBroker(t *testing.T) {
	reg := newMockBrokerSub()
	hub := NewHub(reg)

	c := newTestClient(hub)
	hub.Register(c)
	hub.Subscribe(c, "broker1", []string{"my/topic"})
	hub.Unregister(c)

	reg.mu.Lock()
	unsubbed := make([]string, len(reg.unsubscribed))
	copy(unsubbed, reg.unsubscribed)
	reg.mu.Unlock()

	found := false
	for _, key := range unsubbed {
		if key == "broker1:my/topic" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected Unsubscribe called for broker1:my/topic, got %v", unsubbed)
	}
}

func TestSubscribe_SingleMQTTSubscriptionPerTopic(t *testing.T) {
	reg := newMockBrokerSub()
	hub := NewHub(reg)

	c1 := newTestClient(hub)
	c2 := newTestClient(hub)
	hub.Register(c1)
	hub.Register(c2)

	hub.Subscribe(c1, "b1", []string{"shared/topic"})
	hub.Subscribe(c2, "b1", []string{"shared/topic"})

	// registry Subscribe should only be called once for the same broker+topic
	reg.mu.Lock()
	n := len(reg.subscribed)
	reg.mu.Unlock()

	if n != 1 {
		t.Errorf("expected 1 MQTT subscription for shared topic, got %d", n)
	}
}

func TestBuildMQTTHandler_DropOnFullChannel(t *testing.T) {
	reg := newMockBrokerSub()
	hub := NewHub(reg)

	// Create client with a channel that's already full
	c := &Client{
		id:      uuid.New().String(),
		panelID: "panel1",
		hub:     hub,
		send:    make(chan WSMessage), // no buffer (unbuffered)
	}
	hub.Register(c)
	hub.Subscribe(c, "broker1", []string{"t"})

	// This should not block (drop on full)
	done := make(chan struct{})
	go func() {
		reg.trigger("broker1", "t", []byte("data"))
		close(done)
	}()

	select {
	case <-done:
		// success — did not block
	case <-make(chan struct{}):
		t.Fatal("trigger blocked unexpectedly")
	}
}
