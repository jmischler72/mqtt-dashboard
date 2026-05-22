package mqtt

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"strings"
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

	scheme := "tcp"
	if broker.TLSEnabled {
		scheme = "tls"
	}
	brokerAddr := fmt.Sprintf("%s://%s:%d", scheme, broker.Host, broker.Port)
	slog.Info("mqtt connecting", "broker", broker.Name, "addr", brokerAddr)

	opts := paho.NewClientOptions().
		AddBroker(brokerAddr).
		SetClientID(broker.ClientID).
		SetConnectTimeout(10 * time.Second).
		SetAutoReconnect(true).
		SetMaxReconnectInterval(30 * time.Second).
		SetConnectionLostHandler(func(_ paho.Client, err error) {
			slog.Warn("mqtt connection lost", "err", err)
			m.mu.Lock()
			m.setStatus("DISCONNECTED")
			m.mu.Unlock()
		}).
		SetOnConnectHandler(func(_ paho.Client) {
			slog.Info("mqtt connected")
			m.mu.Lock()
			m.setStatus("CONNECTED")
			// Resubscribe after reconnect.
			// '#' does NOT match '$SYS/*' topics by MQTT spec. '$SYS/#'
			// covers all specific $SYS topics. Avoid overlapping subs.
			if len(m.subs["#"]) > 0 {
				m.client.Subscribe("#", 0, m.buildHandler("#")) //nolint
			}
			if len(m.subs["$SYS/#"]) > 0 {
				m.client.Subscribe("$SYS/#", 0, m.buildHandler("$SYS/#")) //nolint
			}
			for topic, handlers := range m.subs {
				if topic == "#" || topic == "$SYS/#" || len(handlers) == 0 {
					continue
				}
				// Skip topics covered by '#' or '$SYS/#'.
				if len(m.subs["#"]) > 0 && !isSysFilter(topic) {
					continue
				}
				if len(m.subs["$SYS/#"]) > 0 && isSysFilter(topic) {
					continue
				}
				m.client.Subscribe(topic, 0, m.buildHandler(topic)) //nolint
			}
			m.mu.Unlock()
		})

	// Configure TLS if enabled.
	if broker.TLSEnabled {
		tlsCfg := &tls.Config{
			InsecureSkipVerify: broker.TLSSkipVerify, //nolint:gosec // user-controlled opt-in
		}
		if broker.CACert != "" {
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM([]byte(broker.CACert)) {
				return fmt.Errorf("failed to parse CA certificate")
			}
			tlsCfg.RootCAs = pool
		}
		if broker.ClientCert != "" && broker.ClientKey != "" {
			cert, err := tls.X509KeyPair([]byte(broker.ClientCert), []byte(broker.ClientKey))
			if err != nil {
				return fmt.Errorf("failed to parse client certificate: %w", err)
			}
			tlsCfg.Certificates = []tls.Certificate{cert}
		}
		opts.SetTLSConfig(tlsCfg)
	}

	// Configure authentication based on auth mode.
	switch broker.AuthMode {
	case "password":
		if broker.Username != "" {
			opts.SetUsername(broker.Username)
		}
		if broker.Password != "" {
			opts.SetPassword(broker.Password)
		}
	}

	client := paho.NewClient(opts)
	m.client = client

	token := client.Connect()
	if token.WaitTimeout(10*time.Second) && token.Error() != nil {
		slog.Error("mqtt connect failed", "err", token.Error())
		m.setStatus("ERROR")
		return fmt.Errorf("connect: %w", token.Error())
	}
	if !client.IsConnected() {
		slog.Error("mqtt connection failed")
		m.setStatus("ERROR")
		return fmt.Errorf("connection failed")
	}

	return nil
}

func (m *MQTTManager) Disconnect() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client != nil && m.client.IsConnected() {
		slog.Info("mqtt disconnecting")
		m.client.Disconnect(500)
	}
	m.setStatus("DISCONNECTED")
}

func (m *MQTTManager) Status() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}

func (m *MQTTManager) Publish(topic string, qos byte, retain bool, payload []byte) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.client == nil || !m.client.IsConnected() {
		return fmt.Errorf("not connected")
	}
	token := m.client.Publish(topic, qos, retain, payload)
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
	slog.Debug("mqtt subscribe", "topic", topic)
	if topic == "#" {
		// '#' now covers non-$SYS topics. Keep $SYS subscriptions because '#'
		// does not match reserved '$' topics.
		for t := range m.subs {
			if t != "#" && !isSysFilter(t) {
				m.client.Unsubscribe(t) //nolint
			}
		}
		token := m.client.Subscribe("#", 0, m.buildHandler("#"))
		token.Wait()
		return token.Error()
	}
	if topic == "$SYS/#" {
		// '$SYS/#' covers all $SYS topics. Unsubscribe specific $SYS MQTT
		// subscriptions to avoid overlapping deliveries.
		for t := range m.subs {
			if t != "$SYS/#" && isSysFilter(t) {
				m.client.Unsubscribe(t) //nolint
			}
		}
		token := m.client.Subscribe("$SYS/#", 0, m.buildHandler("$SYS/#"))
		token.Wait()
		return token.Error()
	}
	// Specific topic: skip MQTT subscribe only if '#' or '$SYS/#' can cover it.
	if len(m.subs["#"]) > 0 && !isSysFilter(topic) {
		return nil
	}
	if len(m.subs["$SYS/#"]) > 0 && isSysFilter(topic) {
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
				// Don't restore specific $SYS topics if $SYS/# is still active.
				if isSysFilter(t) && t != "$SYS/#" && len(m.subs["$SYS/#"]) > 0 {
					continue
				}
				m.client.Subscribe(t, 0, m.buildHandler(t)) //nolint
			}
		}
		return
	}
	if topic == "$SYS/#" {
		// '$SYS/#' removed — restore individual $SYS MQTT subscriptions.
		m.client.Unsubscribe("$SYS/#") //nolint
		for t, hs := range m.subs {
			if len(hs) > 0 && isSysFilter(t) && t != "$SYS/#" {
				m.client.Subscribe(t, 0, m.buildHandler(t)) //nolint
			}
		}
		return
	}
	// Specific topic: only unsubscribe from MQTT if it's not covered by '#' or '$SYS/#'.
	if len(m.subs["#"]) > 0 && !isSysFilter(topic) {
		return // covered by '#'
	}
	if len(m.subs["$SYS/#"]) > 0 && isSysFilter(topic) {
		return // covered by '$SYS/#'
	}
	m.client.Unsubscribe(topic) //nolint
}

func isSysFilter(topic string) bool {
	return strings.HasPrefix(topic, "$SYS/") || topic == "$SYS/#"
}

// buildHandler returns a paho handler for the given subscription topic.
// When topic is "#" or "$SYS/#", it additionally dispatches to handlers
// registered under the specific incoming topic — because those specific topics
// have no MQTT-level subscription while the wildcard is active, preventing
// overlapping broker deliveries.
func (m *MQTTManager) buildHandler(topic string) paho.MessageHandler {
	return func(_ paho.Client, msg paho.Message) {
		msgTopic := msg.Topic()
		m.mu.RLock()

		// Paho's '#' route matches $SYS topics at the client level even though
		// the MQTT broker excludes them from '#' delivery. When '$SYS/#' is
		// also subscribed, let that handler process $SYS messages to avoid
		// double dispatch.
		if topic == "#" && strings.HasPrefix(msgTopic, "$SYS/") && len(m.subs["$SYS/#"]) > 0 {
			m.mu.RUnlock()
			return
		}

		handlers := make([]MessageHandler, len(m.subs[topic]))
		copy(handlers, m.subs[topic])
		var specificHandlers []MessageHandler
		if (topic == "#" || topic == "$SYS/#") && msgTopic != topic {
			if hs := m.subs[msgTopic]; len(hs) > 0 {
				specificHandlers = make([]MessageHandler, len(hs))
				copy(specificHandlers, hs)
			}
			// Also dispatch to sub-wildcard pattern handlers (e.g. "sensors/#",
			// "home/+/status") whose MQTT-level subscription was intentionally
			// skipped because the global "#" or "$SYS/#" already covers them.
			for t, hs := range m.subs {
				if t == topic || t == msgTopic || len(hs) == 0 || !HasWildcard(t) {
					continue
				}
				if TopicMatches(t, msgTopic) {
					specificHandlers = append(specificHandlers, hs...)
				}
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
