package handlers

import (
	"mqtt-dashboard/cron"
	"mqtt-dashboard/models"
)

// BrokerRegistry is the interface for managing MQTT broker connections.
type BrokerRegistry interface {
	AddBroker(broker models.MQTTBroker) error
	RemoveBroker(id string)
	SetDefault(id string)
	DefaultBrokerID() string
	Status(id string) string
	StatusError(id string) string
	Publish(brokerID, topic string, qos byte, retain bool, payload []byte) error
	GetStats(brokerID string) *models.BrokerStats
}

// CronScheduler is the interface for managing scheduled publish jobs.
type CronScheduler interface {
	AddJob(panelID, brokerID, cronExpr, topic, payload string, qos byte, retain bool, enabled bool) error
	RemoveJob(panelID string)
	ToggleJob(panelID string, enabled bool) error
	GetJob(panelID string) (*cron.JobInfo, bool)
}
