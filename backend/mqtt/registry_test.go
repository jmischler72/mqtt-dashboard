package mqtt

import (
	"fmt"
	"sync"
	"testing"

	"mqtt-dashboard/testutil"
)

func TestNewRegistry_Empty(t *testing.T) {
	r := NewRegistry(nil)
	if r.DefaultBrokerID() != "" {
		t.Error("expected empty default broker ID on new registry")
	}
	statuses := r.AllStatuses()
	if len(statuses) != 0 {
		t.Errorf("expected empty statuses, got %v", statuses)
	}
}

func TestSetDefault_GetDefault(t *testing.T) {
	r := NewRegistry(nil)
	r.SetDefault("broker1")
	if got := r.DefaultBrokerID(); got != "broker1" {
		t.Errorf("DefaultBrokerID = %q, want 'broker1'", got)
	}
}

func TestStatus_NonExistentBroker(t *testing.T) {
	r := NewRegistry(nil)
	if s := r.Status("nonexistent"); s != "DISCONNECTED" {
		t.Errorf("Status = %q, want DISCONNECTED", s)
	}
}

func TestGetClient_NonExistent(t *testing.T) {
	r := NewRegistry(nil)
	_, ok := r.GetClient("missing")
	if ok {
		t.Error("expected ok=false for non-existent broker")
	}
}

func TestAllStatuses_ReturnsAll(t *testing.T) {
	r := NewRegistry(nil)
	// Manually inject managers to avoid network calls
	r.mu.Lock()
	r.clients["b1"] = NewManager()
	r.clients["b2"] = NewManager()
	r.mu.Unlock()

	statuses := r.AllStatuses()
	if len(statuses) != 2 {
		t.Errorf("expected 2 statuses, got %d", len(statuses))
	}
	for id, s := range statuses {
		if s != "DISCONNECTED" {
			t.Errorf("broker %q status = %q, want DISCONNECTED", id, s)
		}
	}
}

func TestRemoveBroker_ClearsDefault(t *testing.T) {
	r := NewRegistry(nil)
	r.mu.Lock()
	mgr := NewManager()
	r.clients["b1"] = mgr
	r.mu.Unlock()
	r.SetDefault("b1")

	r.RemoveBroker("b1")

	if r.DefaultBrokerID() != "" {
		t.Error("expected defaultBrokerID to be cleared after removing default broker")
	}
	if _, ok := r.GetClient("b1"); ok {
		t.Error("broker should be removed from clients map")
	}
}

func TestRemoveBroker_NonExistentNoError(t *testing.T) {
	r := NewRegistry(nil)
	// Should not panic
	r.RemoveBroker("nonexistent")
}

func TestPublish_BrokerNotFound(t *testing.T) {
	r := NewRegistry(nil)
	err := r.Publish("missing", "test/topic", 0, false, []byte("data"))
	if err == nil {
		t.Error("expected error for missing broker")
	}
}

func TestSubscribe_BrokerNotFound(t *testing.T) {
	r := NewRegistry(nil)
	err := r.Subscribe("missing", "test/topic", func(string, []byte) {})
	if err == nil {
		t.Error("expected error for missing broker")
	}
}

func TestUnsubscribe_BrokerNotFound(t *testing.T) {
	r := NewRegistry(nil)
	// Should not panic
	r.Unsubscribe("missing", "test/topic", func(string, []byte) {})
}

func TestWriteHistory_PersistsRecord(t *testing.T) {
	database := testutil.SetupTestDB(t)
	r := NewRegistry(database)

	r.writeHistory("b1", "sensor/temp", []byte("25"))

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_history WHERE broker_id='b1' AND topic='sensor/temp'`).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 history record, got %d", count)
	}
}

func TestWriteHistory_StoresSysTopic(t *testing.T) {
	database := testutil.SetupTestDB(t)
	r := NewRegistry(database)
	r.SetSaveSysTopics(true)

	r.writeHistory("b1", "$SYS/broker/clients/connected", []byte("5"))

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_history WHERE broker_id='b1'`).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 record for $SYS/ topic, got %d", count)
	}
}

func TestWriteHistory_NilDB(t *testing.T) {
	r := NewRegistry(nil)
	// Should not panic with nil db
	r.writeHistory("b1", "test/topic", []byte("data"))
}

func TestSubscribe_CallsManagerSubscribe(t *testing.T) {
	r := NewRegistry(nil)
	mgr := NewManager()
	r.mu.Lock()
	r.clients["b1"] = mgr
	r.mu.Unlock()

	called := false
	if err := r.Subscribe("b1", "my/topic", func(string, []byte) { called = true }); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	if len(mgr.subs["my/topic"]) != 1 {
		t.Errorf("expected 1 handler registered on manager, got %d", len(mgr.subs["my/topic"]))
	}
	_ = called
}

func TestUnsubscribe_CallsManagerUnsubscribe(t *testing.T) {
	r := NewRegistry(nil)
	mgr := NewManager()
	r.mu.Lock()
	r.clients["b1"] = mgr
	r.mu.Unlock()

	h := func(string, []byte) {}
	mgr.subs["my/topic"] = []MessageHandler{h}

	// Should not panic and should remove the handler
	r.Unsubscribe("b1", "my/topic", h)

	if _, ok := mgr.subs["my/topic"]; ok {
		t.Error("expected 'my/topic' to be removed from subs after unsubscribe")
	}
}

func TestPublish_ConnectedBroker(t *testing.T) {
	r := NewRegistry(nil)
	mock := &mockPahoClient{connected: true}
	mgr := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}
	r.mu.Lock()
	r.clients["b1"] = mgr
	r.mu.Unlock()

	if err := r.Publish("b1", "test/topic", 0, false, []byte("hello")); err != nil {
		t.Errorf("Publish: unexpected error: %v", err)
	}
}

func TestStatus_ExistingBroker(t *testing.T) {
	r := NewRegistry(nil)
	mgr := NewManager()
	mgr.setStatus("CONNECTED")
	r.mu.Lock()
	r.clients["b1"] = mgr
	r.mu.Unlock()

	if s := r.Status("b1"); s != "CONNECTED" {
		t.Errorf("status = %q, want CONNECTED", s)
	}
}

func TestGetStats_ReturnsCachedStats(t *testing.T) {
	r := NewRegistry(nil)
	r.statsCache.UpdateStat("b1", "version", "1.6.0")
	r.statsCache.UpdateStat("b1", "clients_connected", 3)

	stats := r.GetStats("b1")
	if stats.Version != "1.6.0" {
		t.Errorf("Version = %q, want '1.6.0'", stats.Version)
	}
	if stats.ClientsConnected != 3 {
		t.Errorf("ClientsConnected = %d, want 3", stats.ClientsConnected)
	}
}

func TestGetStats_UnknownBrokerReturnsZero(t *testing.T) {
	r := NewRegistry(nil)
	stats := r.GetStats("nonexistent")
	if stats == nil {
		t.Fatal("expected non-nil stats")
	}
	if stats.Version != "" {
		t.Errorf("expected empty Version, got %q", stats.Version)
	}
}

func TestParseSysStats_Version(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/version", []byte("mosquitto version 2.0.18"))
	stats := r.GetStats("b1")
	if stats.Version != "mosquitto version 2.0.18" {
		t.Errorf("Version = %q, want 'mosquitto version 2.0.18'", stats.Version)
	}
}

func TestParseSysStats_Uptime(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/uptime", []byte("3600"))
	stats := r.GetStats("b1")
	if stats.Uptime != 3600 {
		t.Errorf("Uptime = %d, want 3600", stats.Uptime)
	}
}

func TestParseSysStats_ClientsConnected(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/clients/connected", []byte("5"))
	stats := r.GetStats("b1")
	if stats.ClientsConnected != 5 {
		t.Errorf("ClientsConnected = %d, want 5", stats.ClientsConnected)
	}
}

func TestParseSysStats_MessagesSent(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/messages/sent", []byte("1000"))
	stats := r.GetStats("b1")
	if stats.MessagesSent != 1000 {
		t.Errorf("MessagesSent = %d, want 1000", stats.MessagesSent)
	}
}

func TestParseSysStats_MessagesReceived(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/messages/received", []byte("500"))
	stats := r.GetStats("b1")
	if stats.MessagesReceived != 500 {
		t.Errorf("MessagesReceived = %d, want 500", stats.MessagesReceived)
	}
}

func TestParseSysStats_Messages5mSent(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/load/messages/sent/5min", []byte("42"))
	stats := r.GetStats("b1")
	if stats.Messages5mSent != 42 {
		t.Errorf("Messages5mSent = %d, want 42", stats.Messages5mSent)
	}
}

func TestParseSysStats_Messages5mReceived(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/load/messages/received/5min", []byte("21"))
	stats := r.GetStats("b1")
	if stats.Messages5mReceived != 21 {
		t.Errorf("Messages5mReceived = %d, want 21", stats.Messages5mReceived)
	}
}

func TestParseSysStats_MemoryUsed(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/heap/current", []byte("2048"))
	stats := r.GetStats("b1")
	if stats.MemoryUsed != 2048 {
		t.Errorf("MemoryUsed = %d, want 2048", stats.MemoryUsed)
	}
}

func TestParseSysStats_MemoryMax(t *testing.T) {
	r := NewRegistry(nil)
	r.parseSysStats("b1", "$SYS/broker/heap/maximum", []byte("8192"))
	stats := r.GetStats("b1")
	if stats.MemoryMax != 8192 {
		t.Errorf("MemoryMax = %d, want 8192", stats.MemoryMax)
	}
}

func TestParseSysStats_NonSysTopic_Ignored(t *testing.T) {
	r := NewRegistry(nil)
	// Should not panic and should not store anything
	r.parseSysStats("b1", "some/regular/topic", []byte("data"))
	stats := r.GetStats("b1")
	if stats.Version != "" {
		t.Error("expected no stats update for non-$SYS topic")
	}
}

func TestWriteHistory_WithWorker_PersistsAllRapidWrites(t *testing.T) {
	database := testutil.SetupTestDB(t)
	r := NewRegistry(database)
	r.StartHistoryWriter()

	const total = 400
	var wg sync.WaitGroup
	wg.Add(total)
	for i := 0; i < total; i++ {
		i := i
		go func() {
			defer wg.Done()
			r.writeHistory("b1", "rapid/topic", []byte(fmt.Sprintf("payload-%d", i)))
		}()
	}
	wg.Wait()
	r.StopHistoryWriter()

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM mqtt_history WHERE broker_id='b1' AND topic='rapid/topic'`).Scan(&count); err != nil {
		t.Fatalf("count history records: %v", err)
	}
	if count != total {
		t.Fatalf("expected %d history records, got %d", total, count)
	}
}

func TestStopHistoryWriter_DrainsPendingMessages(t *testing.T) {
	database := testutil.SetupTestDB(t)
	r := NewRegistry(database)
	r.StartHistoryWriter()

	const total = 150
	for i := 0; i < total; i++ {
		r.writeHistory("b1", "drain/topic", []byte(fmt.Sprintf("msg-%d", i)))
	}

	// Stop should block until queued writes have been persisted.
	r.StopHistoryWriter()

	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM mqtt_history WHERE broker_id='b1' AND topic='drain/topic'`).Scan(&count); err != nil {
		t.Fatalf("count drained records: %v", err)
	}
	if count != total {
		t.Fatalf("expected %d drained records, got %d", total, count)
	}
}
