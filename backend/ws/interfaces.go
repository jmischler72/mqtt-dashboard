package ws

import mqttclient "mqtt-dashboard/mqtt"

// BrokerSubscriber is the interface for subscribing to MQTT topics across brokers.
type BrokerSubscriber interface {
	Subscribe(brokerID, topic string, handler mqttclient.MessageHandler) error
	Unsubscribe(brokerID, topic string, handler mqttclient.MessageHandler)
	DefaultBrokerID() string
	// IsRetained reports whether the broker currently holds a retained message
	// for the given concrete topic.
	IsRetained(brokerID, topic string) bool
	// GetRetainedPanel returns the source panel ID that published the retained message on this topic, if known.
	GetRetainedPanel(brokerID, topic string) string
}
