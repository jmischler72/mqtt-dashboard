package handlers_test

import (
	"errors"
	"fmt"
	"sync"

	"mqtt-dashboard/cron"
	"mqtt-dashboard/models"
)

// errTest is a sentinel error used in tests.
var errTest = errors.New("test error")

// mockRegistry implements handlers.BrokerRegistry.
type mockRegistry struct {
	mu           sync.Mutex
	statuses     map[string]string
	defaultID    string
	publishErr   error
	addBrokerErr error
	publishCalls []publishCall
}

type publishCall struct {
	brokerID string
	topic    string
	payload  []byte
	qos      byte
	retain   bool
}

func newMockRegistry() *mockRegistry {
	return &mockRegistry{
		statuses: make(map[string]string),
	}
}

func (m *mockRegistry) AddBroker(broker models.MQTTBroker) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.addBrokerErr != nil {
		m.statuses[broker.ID] = "ERROR"
		return m.addBrokerErr
	}
	m.statuses[broker.ID] = "CONNECTED"
	return nil
}

func (m *mockRegistry) RemoveBroker(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.statuses, id)
	if m.defaultID == id {
		m.defaultID = ""
	}
}

func (m *mockRegistry) SetDefault(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.defaultID = id
}

func (m *mockRegistry) DefaultBrokerID() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.defaultID
}

func (m *mockRegistry) Status(id string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.statuses[id]; ok {
		return s
	}
	return "DISCONNECTED"
}

func (m *mockRegistry) Publish(brokerID, topic string, qos byte, retain bool, payload []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.publishCalls = append(m.publishCalls, publishCall{brokerID, topic, payload, qos, retain})
	return m.publishErr
}

func (m *mockRegistry) GetStats(brokerID string) *models.BrokerStats {
	return &models.BrokerStats{
		Version:          "test-version",
		Uptime:           3600,
		ClientsConnected: 1,
	}
}

// mockScheduler implements handlers.CronScheduler.
type mockScheduler struct {
	mu        sync.Mutex
	jobs      map[string]*cron.JobInfo
	addErr    error
	toggleErr error
	addCalls  int
}

func newMockScheduler() *mockScheduler {
	return &mockScheduler{jobs: make(map[string]*cron.JobInfo)}
}

func (m *mockScheduler) AddJob(panelID, brokerID, cronExpr, topic, payload string, qos byte, retain bool, enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.addCalls++
	if m.addErr != nil {
		return m.addErr
	}
	m.jobs[panelID] = &cron.JobInfo{
		PanelID:  panelID,
		BrokerID: brokerID,
		CronExpr: cronExpr,
		Topic:    topic,
		Payload:  payload,
		QoS:      qos,
		Retain:   retain,
		Enabled:  enabled,
	}
	return nil
}

func (m *mockScheduler) RemoveJob(panelID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.jobs, panelID)
}

func (m *mockScheduler) ToggleJob(panelID string, enabled bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.toggleErr != nil {
		return m.toggleErr
	}
	if info, ok := m.jobs[panelID]; ok {
		info.Enabled = enabled
		return nil
	}
	return fmt.Errorf("job %q not found", panelID)
}

func (m *mockScheduler) GetJob(panelID string) (*cron.JobInfo, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	info, ok := m.jobs[panelID]
	return info, ok
}
