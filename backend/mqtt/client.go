package mqtt

import (
	"fmt"
	"sync"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"

	"mqtt-dashboard/models"
)

type MessageHandler func(topic string, payload []byte)

type MQTTManager struct {
	mu     sync.RWMutex
	client paho.Client
	status string
	subs   map[string][]MessageHandler
}

func NewManager() *MQTTManager {
	return &MQTTManager{
		status: "DISCONNECTED",
		subs:   make(map[string][]MessageHandler),
	}
}

func (m *MQTTManager) Connect(broker models.MQTTBroker) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil && m.client.IsConnected() {
		m.client.Disconnect(500)
	}

	m.setStatus("CONNECTING")

	opts := paho.NewClientOptions().
		AddBroker(fmt.Sprintf("tcp://%s:%d", broker.Host, broker.Port)).
		SetClientID(broker.ClientID).
		SetConnectTimeout(10 * time.Second).
		SetAutoReconnect(true).
		SetMaxReconnectInterval(30 * time.Second).
		SetConnectionLostHandler(func(_ paho.Client, err error) {
			m.mu.Lock()
			m.setStatus("DISCONNECTED")
			m.mu.Unlock()
		}).
		SetOnConnectHandler(func(_ paho.Client) {
			m.mu.Lock()
			m.setStatus("CONNECTED")
			// Resubscribe after reconnect. If '#' is active it covers all specific topics,
			// so only subscribe '#' to avoid overlapping MQTT deliveries from the broker.
			if len(m.subs["#"]) > 0 {
				m.client.Subscribe("#", 0, m.buildHandler("#")) //nolint
			} else {
				for topic, handlers := range m.subs {
					if len(handlers) > 0 {
						m.client.Subscribe(topic, 0, m.buildHandler(topic)) //nolint
					}
				}
			}
			m.mu.Unlock()
		})

	if broker.Username != "" {
		opts.SetUsername(broker.Username)
	}
	if broker.Password != "" {
		opts.SetPassword(broker.Password)
	}

	client := paho.NewClient(opts)
	m.client = client

	token := client.Connect()
	if token.WaitTimeout(10*time.Second) && token.Error() != nil {
		m.setStatus("ERROR")
		return fmt.Errorf("connect: %w", token.Error())
	}
	if !client.IsConnected() {
		m.setStatus("ERROR")
		return fmt.Errorf("connection failed")
	}

	return nil
}

func (m *MQTTManager) Disconnect() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client != nil && m.client.IsConnected() {
		m.client.Disconnect(500)
	}
	m.setStatus("DISCONNECTED")
}

func (m *MQTTManager) Status() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}

func (m *MQTTManager) Publish(topic string, payload []byte) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.client == nil || !m.client.IsConnected() {
		return fmt.Errorf("not connected")
	}
	token := m.client.Publish(topic, 0, false, payload)
	token.Wait()
	return token.Error()
}

func (m *MQTTManager) Subscribe(topic string, handler MessageHandler) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	wasEmpty := len(m.subs[topic]) == 0
	m.subs[topic] = append(m.subs[topic], handler)
	if !wasEmpty || m.client == nil || !m.client.IsConnected() {
		return nil
	}
	if topic == "#" {
		// '#' now covers all topics — remove any specific MQTT subscriptions that are
		// now redundant to prevent the broker from delivering messages twice.
		for t := range m.subs {
			if t != "#" {
				m.client.Unsubscribe(t) //nolint
			}
		}
		token := m.client.Subscribe("#", 0, m.buildHandler("#"))
		token.Wait()
		return token.Error()
	}
	// Specific topic: skip the MQTT subscribe if '#' is already active — it already
	// covers this topic, and buildHandler("#") will dispatch to our handlers.
	if len(m.subs["#"]) > 0 {
		return nil
	}
	token := m.client.Subscribe(topic, 0, m.buildHandler(topic))
	token.Wait()
	return token.Error()
}

func (m *MQTTManager) Unsubscribe(topic string, _ MessageHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()

	handlers, ok := m.subs[topic]
	if !ok || len(handlers) == 0 {
		return
	}
	handlers = handlers[:len(handlers)-1]
	if len(handlers) > 0 {
		m.subs[topic] = handlers
		return
	}
	// Last handler for this topic removed.
	delete(m.subs, topic)
	if m.client == nil || !m.client.IsConnected() {
		return
	}
	if topic == "#" {
		// '#' removed — restore individual MQTT subscriptions for remaining specific topics.
		m.client.Unsubscribe("#") //nolint
		for t, hs := range m.subs {
			if len(hs) > 0 {
				m.client.Subscribe(t, 0, m.buildHandler(t)) //nolint
			}
		}
		return
	}
	// Specific topic: only unsubscribe from MQTT if '#' is not currently covering it.
	if len(m.subs["#"]) == 0 {
		m.client.Unsubscribe(topic) //nolint
	}
}

// buildHandler returns a paho handler for the given subscription topic.
// When topic is "#", it additionally dispatches to handlers registered under the
// specific incoming topic — because those specific topics have no MQTT-level
// subscription while "#" is active, preventing overlapping broker deliveries.
func (m *MQTTManager) buildHandler(topic string) paho.MessageHandler {
	return func(_ paho.Client, msg paho.Message) {
		msgTopic := msg.Topic()
		m.mu.RLock()
		handlers := make([]MessageHandler, len(m.subs[topic]))
		copy(handlers, m.subs[topic])
		var specificHandlers []MessageHandler
		if topic == "#" && msgTopic != "#" {
			if hs := m.subs[msgTopic]; len(hs) > 0 {
				specificHandlers = make([]MessageHandler, len(hs))
				copy(specificHandlers, hs)
			}
		}
		m.mu.RUnlock()
		for _, h := range handlers {
			h(msgTopic, msg.Payload())
		}
		for _, h := range specificHandlers {
			h(msgTopic, msg.Payload())
		}
	}
}

func (m *MQTTManager) setStatus(s string) {
	m.status = s
}
