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
}
