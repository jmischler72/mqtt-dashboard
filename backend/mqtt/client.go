package mqtt

import (
	"fmt"
	"sync"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"

	"mqtt-dashboard/models"
)

type MessageHandler func(topic string, payload []byte)

// ConfigRow is a helper for scanning DB rows into a Connect-ready struct.
type ConfigRow struct {
	Host     string
	Port     int
	ClientID string
	Username string
	Password string
}

func (c ConfigRow) ToModel() models.MQTTConfig {
	return models.MQTTConfig{
		Host:     c.Host,
		Port:     c.Port,
		ClientID: c.ClientID,
		Username: c.Username,
		Password: c.Password,
		IsActive: true,
	}
}

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

func (m *MQTTManager) Connect(cfg models.MQTTConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.client != nil && m.client.IsConnected() {
		m.client.Disconnect(500)
	}

	m.setStatus("CONNECTING")

	opts := paho.NewClientOptions().
		AddBroker(fmt.Sprintf("tcp://%s:%d", cfg.Host, cfg.Port)).
		SetClientID(cfg.ClientID).
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
			// Resubscribe all topics after reconnect
			for topic, handlers := range m.subs {
				if len(handlers) > 0 {
					m.client.Subscribe(topic, 0, m.buildHandler(topic)) //nolint
				}
			}
			m.mu.Unlock()
		})

	if cfg.Username != "" {
		opts.SetUsername(cfg.Username)
	}
	if cfg.Password != "" {
		opts.SetPassword(cfg.Password)
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
	m.subs[topic] = append(m.subs[topic], handler)
	if m.client != nil && m.client.IsConnected() {
		token := m.client.Subscribe(topic, 0, m.buildHandler(topic))
		token.Wait()
		return token.Error()
	}
	return nil
}

func (m *MQTTManager) Unsubscribe(topic string, _ MessageHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// This dashboard uses one effective handler per topic; clear the topic atomically
	// to avoid stale handlers when clients reconnect/resubscribe.
	delete(m.subs, topic)
	if m.client != nil && m.client.IsConnected() {
		m.client.Unsubscribe(topic) //nolint
	}
}

// buildHandler must be called with m.mu held.
func (m *MQTTManager) buildHandler(topic string) paho.MessageHandler {
	return func(_ paho.Client, msg paho.Message) {
		m.mu.RLock()
		handlers := make([]MessageHandler, len(m.subs[msg.Topic()]))
		copy(handlers, m.subs[msg.Topic()])
		m.mu.RUnlock()
		for _, h := range handlers {
			h(msg.Topic(), msg.Payload())
		}
	}
}

func (m *MQTTManager) setStatus(s string) {
	m.status = s
}
