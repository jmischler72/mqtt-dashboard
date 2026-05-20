package mqtt

import (
	"testing"
)

func TestNewStatsCache_Empty(t *testing.T) {
	sc := NewStatsCache()
	if sc == nil {
		t.Fatal("expected non-nil StatsCache")
	}
	if sc.stats == nil {
		t.Error("expected initialized stats map")
	}
}

func TestUpdateStat_CreatesEntryOnFirstUpdate(t *testing.T) {
	sc := NewStatsCache()
	sc.UpdateStat("b1", "version", "1.6.0")
	stats := sc.GetStats("b1")
	if stats.Version != "1.6.0" {
		t.Errorf("Version = %q, want '1.6.0'", stats.Version)
	}
}

func TestUpdateStat_AllKeys(t *testing.T) {
	sc := NewStatsCache()

	sc.UpdateStat("b1", "version", "2.0.0")
	sc.UpdateStat("b1", "uptime", int64(7200))
	sc.UpdateStat("b1", "clients_connected", 5)
	sc.UpdateStat("b1", "messages_sent", int64(100))
	sc.UpdateStat("b1", "messages_received", int64(200))
	sc.UpdateStat("b1", "messages_5m_sent", int64(10))
	sc.UpdateStat("b1", "messages_5m_received", int64(20))
	sc.UpdateStat("b1", "memory_used", int64(1024))
	sc.UpdateStat("b1", "memory_max", int64(4096))

	stats := sc.GetStats("b1")

	if stats.Version != "2.0.0" {
		t.Errorf("Version = %q, want '2.0.0'", stats.Version)
	}
	if stats.Uptime != 7200 {
		t.Errorf("Uptime = %d, want 7200", stats.Uptime)
	}
	if stats.ClientsConnected != 5 {
		t.Errorf("ClientsConnected = %d, want 5", stats.ClientsConnected)
	}
	if stats.MessagesSent != 100 {
		t.Errorf("MessagesSent = %d, want 100", stats.MessagesSent)
	}
	if stats.MessagesReceived != 200 {
		t.Errorf("MessagesReceived = %d, want 200", stats.MessagesReceived)
	}
	if stats.Messages5mSent != 10 {
		t.Errorf("Messages5mSent = %d, want 10", stats.Messages5mSent)
	}
	if stats.Messages5mReceived != 20 {
		t.Errorf("Messages5mReceived = %d, want 20", stats.Messages5mReceived)
	}
	if stats.MemoryUsed != 1024 {
		t.Errorf("MemoryUsed = %d, want 1024", stats.MemoryUsed)
	}
	if stats.MemoryMax != 4096 {
		t.Errorf("MemoryMax = %d, want 4096", stats.MemoryMax)
	}
}

func TestUpdateStat_WrongTypeIsIgnored(t *testing.T) {
	sc := NewStatsCache()
	sc.UpdateStat("b1", "uptime", "not-an-int64") // wrong type
	stats := sc.GetStats("b1")
	if stats.Uptime != 0 {
		t.Errorf("Uptime = %d, expected 0 when wrong type passed", stats.Uptime)
	}
}

func TestUpdateStat_UnknownKeyIsIgnored(t *testing.T) {
	sc := NewStatsCache()
	sc.UpdateStat("b1", "unknown_key", "value") // should not panic
	stats := sc.GetStats("b1")
	if stats.Version != "" {
		t.Error("expected no changes for unknown key")
	}
}

func TestUpdateStat_UpdatedAtIsSet(t *testing.T) {
	sc := NewStatsCache()
	sc.UpdateStat("b1", "version", "1.0.0")
	stats := sc.GetStats("b1")
	if stats.UpdatedAt == "" {
		t.Error("expected UpdatedAt to be set after update")
	}
}

func TestGetStats_NonExistentBrokerReturnsZero(t *testing.T) {
	sc := NewStatsCache()
	stats := sc.GetStats("nonexistent")
	if stats == nil {
		t.Fatal("expected non-nil stats for unknown broker")
	}
	if stats.Version != "" {
		t.Errorf("Version = %q, want empty for unknown broker", stats.Version)
	}
	if stats.ClientsConnected != 0 {
		t.Errorf("ClientsConnected = %d, want 0 for unknown broker", stats.ClientsConnected)
	}
	if stats.UpdatedAt == "" {
		t.Error("expected UpdatedAt to be set even for unknown broker")
	}
}

func TestGetStats_ReturnsCopy(t *testing.T) {
	sc := NewStatsCache()
	sc.UpdateStat("b1", "version", "1.0.0")

	stats1 := sc.GetStats("b1")
	stats1.Version = "mutated"

	stats2 := sc.GetStats("b1")
	if stats2.Version == "mutated" {
		t.Error("GetStats should return a copy, not a reference")
	}
}

func TestClearStats_RemovesEntry(t *testing.T) {
	sc := NewStatsCache()
	sc.UpdateStat("b1", "version", "1.0.0")
	sc.ClearStats("b1")

	stats := sc.GetStats("b1")
	if stats.Version != "" {
		t.Error("expected cleared stats after ClearStats")
	}
}

func TestClearAll_RemovesAllEntries(t *testing.T) {
	sc := NewStatsCache()
	sc.UpdateStat("b1", "version", "1.0.0")
	sc.UpdateStat("b2", "uptime", int64(3600))

	sc.ClearAll()

	s1 := sc.GetStats("b1")
	s2 := sc.GetStats("b2")
	if s1.Version != "" {
		t.Error("expected b1 stats to be cleared")
	}
	if s2.Uptime != 0 {
		t.Error("expected b2 stats to be cleared")
	}
}

func TestClearAll_EmptyCacheNoError(t *testing.T) {
	sc := NewStatsCache()
	// Should not panic on empty cache
	sc.ClearAll()
}
