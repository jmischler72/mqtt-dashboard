package cron

// BrokerPublisher is the interface for publishing MQTT messages.
type BrokerPublisher interface {
	Publish(brokerID, topic string, qos byte, retain bool, payload []byte) error
	DefaultBrokerID() string
}
