package cron

// BrokerPublisher is the interface for publishing MQTT messages.
type BrokerPublisher interface {
	Publish(brokerID, topic string, payload []byte) error
	DefaultBrokerID() string
}
