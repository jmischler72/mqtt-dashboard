package mqtt

import (
	"sync"
	"time"

	"mqtt-dashboard/models"
)

// StatsCache stores MQTT broker statistics retrieved from $SYS topics
// All operations are thread-safe
type StatsCache struct {
	mu    sync.RWMutex
	stats map[string]*models.BrokerStats
}

// NewStatsCache creates and returns a new StatsCache instance
func NewStatsCache() *StatsCache {
	return &StatsCache{
		stats: make(map[string]*models.BrokerStats),
	}
}

// UpdateStat updates a specific statistic for a broker
// key should be one of: version, uptime, clients_connected, messages_sent, messages_received,
// messages_5m_sent, messages_5m_received, memory_used, memory_max
func (sc *StatsCache) UpdateStat(brokerID string, key string, value interface{}) {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	if _, exists := sc.stats[brokerID]; !exists {
		sc.stats[brokerID] = &models.BrokerStats{
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		}
	}

	stat := sc.stats[brokerID]

	switch key {
	case "version":
		if v, ok := value.(string); ok {
			stat.Version = v
		}
	case "uptime":
		if v, ok := value.(int64); ok {
			stat.Uptime = v
		}
	case "clients_connected":
		if v, ok := value.(int); ok {
			stat.ClientsConnected = v
		}
	case "messages_sent":
		if v, ok := value.(int64); ok {
			stat.MessagesSent = v
		}
	case "messages_received":
		if v, ok := value.(int64); ok {
			stat.MessagesReceived = v
		}
	case "messages_5m_sent":
		if v, ok := value.(int64); ok {
			stat.Messages5mSent = v
		}
	case "messages_5m_received":
		if v, ok := value.(int64); ok {
			stat.Messages5mReceived = v
		}
	case "memory_used":
		if v, ok := value.(int64); ok {
			stat.MemoryUsed = v
		}
	case "memory_max":
		if v, ok := value.(int64); ok {
			stat.MemoryMax = v
		}
	}

	stat.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
}

// GetStats returns a copy of the stats for a broker
// If broker has no stats, returns a zero-initialized BrokerStats
func (sc *StatsCache) GetStats(brokerID string) *models.BrokerStats {
	sc.mu.RLock()
	defer sc.mu.RUnlock()

	if stat, exists := sc.stats[brokerID]; exists {
		// Return a copy to prevent external mutation
		statCopy := *stat
		return &statCopy
	}

	return &models.BrokerStats{
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

// ClearStats removes all stats for a broker
func (sc *StatsCache) ClearStats(brokerID string) {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	delete(sc.stats, brokerID)
}

// ClearAll removes all cached stats
func (sc *StatsCache) ClearAll() {
	sc.mu.Lock()
	defer sc.mu.Unlock()

	sc.stats = make(map[string]*models.BrokerStats)
}
