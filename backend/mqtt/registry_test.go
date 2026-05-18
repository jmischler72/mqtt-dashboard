package mqtt

import (
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
	err := r.Publish("missing", "test/topic", []byte("data"))
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

func TestWriteHistory_SkipsSysTopic(t *testing.T) {
	database := testutil.SetupTestDB(t)
	r := NewRegistry(database)

	r.writeHistory("b1", "$SYS/broker/clients/connected", []byte("5"))

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_history WHERE broker_id='b1'`).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 records for $SYS/ topic, got %d", count)
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

	if err := r.Publish("b1", "test/topic", []byte("hello")); err != nil {
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
