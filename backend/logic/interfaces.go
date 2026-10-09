package logic

import (
	mqttclient "mqtt-dashboard/mqtt"
)

// BrokerClient is the interface for managing MQTT publish/subscribe operations needed by the logic engine.
type BrokerClient interface {
	Publish(brokerID, topic string, qos byte, retain bool, payload []byte, panelID ...string) error
	Subscribe(brokerID, topic string, handler mqttclient.MessageHandler) error
	Unsubscribe(brokerID, topic string, handler mqttclient.MessageHandler)
	DefaultBrokerID() string
}

// LogicEngine defines the interface for event-driven logic rule execution.
type LogicEngine interface {
	AddRule(rule *Rule) error
	RemoveRule(panelID string)
	ToggleRule(panelID string, enabled bool) error
	GetRule(panelID string) (*Rule, bool)
	GetStatus(panelID string) (*RuleStatus, bool)
	PrimeCache(brokerID, topic, payload string)
	Stop()
}
