package mqtt

import (
	"fmt"
	"sync"

	"mqtt-dashboard/models"
)

// BrokerRegistry manages multiple concurrent MQTT clients, one per broker.
type BrokerRegistry struct {
	mu              sync.RWMutex
	clients         map[string]*MQTTManager // brokerID → manager
	defaultBrokerID string
}

func NewRegistry() *BrokerRegistry {
	return &BrokerRegistry{
		clients: make(map[string]*MQTTManager),
	}
}

// AddBroker creates a new MQTTManager for the broker, connects it, and stores it.
// The manager is stored even on connection failure so its ERROR status is visible.
func (r *BrokerRegistry) AddBroker(broker models.MQTTBroker) error {
	mgr := NewManager()
	err := mgr.Connect(broker)
	r.mu.Lock()
	r.clients[broker.ID] = mgr
	r.mu.Unlock()
	return err
}

// RemoveBroker gracefully disconnects and removes a broker client.
func (r *BrokerRegistry) RemoveBroker(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if mgr, ok := r.clients[id]; ok {
		mgr.Disconnect()
		delete(r.clients, id)
	}
	if r.defaultBrokerID == id {
		r.defaultBrokerID = ""
	}
}

// GetClient returns the MQTTManager for a broker ID.
func (r *BrokerRegistry) GetClient(id string) (*MQTTManager, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	mgr, ok := r.clients[id]
	return mgr, ok
}

// SetDefault sets the default broker ID used as fallback when no broker_id is specified.
func (r *BrokerRegistry) SetDefault(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.defaultBrokerID = id
}

// DefaultBrokerID returns the current default broker ID.
func (r *BrokerRegistry) DefaultBrokerID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.defaultBrokerID
}

// Status returns the connection status of a specific broker.
func (r *BrokerRegistry) Status(id string) string {
	if mgr, ok := r.GetClient(id); ok {
		return mgr.Status()
	}
	return "DISCONNECTED"
}

// AllStatuses returns a map of brokerID → status for all registered clients.
func (r *BrokerRegistry) AllStatuses() map[string]string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make(map[string]string, len(r.clients))
	for id, mgr := range r.clients {
		result[id] = mgr.Status()
	}
	return result
}

// Publish sends a message to a topic on the specified broker.
func (r *BrokerRegistry) Publish(brokerID, topic string, payload []byte) error {
	mgr, ok := r.GetClient(brokerID)
	if !ok {
		return fmt.Errorf("broker %q not found", brokerID)
	}
	return mgr.Publish(topic, payload)
}

// Subscribe registers a handler for a topic on the specified broker.
func (r *BrokerRegistry) Subscribe(brokerID, topic string, handler MessageHandler) error {
	mgr, ok := r.GetClient(brokerID)
	if !ok {
		return fmt.Errorf("broker %q not found", brokerID)
	}
	return mgr.Subscribe(topic, handler)
}

// Unsubscribe removes a handler for a topic on the specified broker.
func (r *BrokerRegistry) Unsubscribe(brokerID, topic string, handler MessageHandler) {
	if mgr, ok := r.GetClient(brokerID); ok {
		mgr.Unsubscribe(topic, handler)
	}
}
