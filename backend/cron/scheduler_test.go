package cron_test

import (
	"testing"
	"time"

	"mqtt-dashboard/cron"
	"mqtt-dashboard/testutil"
)

// mockPublisher implements cron.BrokerPublisher for testing.
type mockPublisher struct {
	calls     []publishCall
	defaultID string
}

type publishCall struct {
	brokerID string
	topic    string
	payload  []byte
}

func (m *mockPublisher) Publish(brokerID, topic string, payload []byte) error {
	m.calls = append(m.calls, publishCall{brokerID, topic, payload})
	return nil
}

func (m *mockPublisher) DefaultBrokerID() string {
	return m.defaultID
}

func TestNewScheduler(t *testing.T) {
	pub := &mockPublisher{}
	sc, err := cron.NewScheduler(pub)
	if err != nil {
		t.Fatalf("NewScheduler: %v", err)
	}
	if sc == nil {
		t.Fatal("expected non-nil scheduler")
	}
}

func TestAddJob_Disabled(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	err := sc.AddJob("panel1", "b1", "*/5 * * * *", "test/topic", "ping", false)
	if err != nil {
		t.Fatalf("AddJob disabled: %v", err)
	}

	info, ok := sc.GetJob("panel1")
	if !ok {
		t.Fatal("expected job to be stored even when disabled")
	}
	if info.Enabled {
		t.Error("job should not be enabled")
	}
}

func TestAddJob_Enabled(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	err := sc.AddJob("panel1", "b1", "*/5 * * * *", "test/topic", "ping", true)
	if err != nil {
		t.Fatalf("AddJob enabled: %v", err)
	}

	info, ok := sc.GetJob("panel1")
	if !ok {
		t.Fatal("expected job to be stored")
	}
	if !info.Enabled {
		t.Error("job should be enabled")
	}
	if info.Topic != "test/topic" {
		t.Errorf("topic = %q, want 'test/topic'", info.Topic)
	}
}

func TestAddJob_InvalidCronExpression(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	err := sc.AddJob("panel1", "b1", "not-a-cron", "t", "p", true)
	if err == nil {
		t.Error("expected error for invalid cron expression")
	}
}

func TestAddJob_ReplacesExisting(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	sc.AddJob("panel1", "b1", "*/5 * * * *", "old/topic", "p", false)  //nolint
	sc.AddJob("panel1", "b1", "*/10 * * * *", "new/topic", "p", false) //nolint

	info, _ := sc.GetJob("panel1")
	if info.Topic != "new/topic" {
		t.Errorf("topic = %q, want 'new/topic' after replacement", info.Topic)
	}
	if info.CronExpr != "*/10 * * * *" {
		t.Errorf("cron_expr = %q, want '*/10 * * * *'", info.CronExpr)
	}
}

func TestRemoveJob(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	sc.AddJob("panel1", "b1", "*/5 * * * *", "t", "p", false) //nolint
	sc.RemoveJob("panel1")

	if _, ok := sc.GetJob("panel1"); ok {
		t.Error("job should be removed")
	}
}

func TestRemoveJob_NonExistentNoError(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()
	// Should not panic
	sc.RemoveJob("nonexistent")
}

func TestToggleJob_EnableDisabled(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	sc.AddJob("panel1", "b1", "*/5 * * * *", "t", "p", false) //nolint

	if err := sc.ToggleJob("panel1", true); err != nil {
		t.Fatalf("ToggleJob: %v", err)
	}

	info, _ := sc.GetJob("panel1")
	if !info.Enabled {
		t.Error("job should be enabled after toggle")
	}
}

func TestToggleJob_NotFound(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	if err := sc.ToggleJob("missing", true); err == nil {
		t.Error("expected error for non-existent job")
	}
}

func TestGetJob_NotFound(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)

	if _, ok := sc.GetJob("missing"); ok {
		t.Error("expected ok=false for non-existent job")
	}
}

func TestStartPruningJob_DeletesOldHistory(t *testing.T) {
	database := testutil.SetupTestDB(t)
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	// Seed old record (older than 24h)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload, timestamp) VALUES ('b1', 'old', 'x', DATETIME('now', '-48 hours'))`)
	// Seed recent record
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'recent', 'y')`)

	if err := sc.StartPruningJob(database); err != nil {
		t.Fatalf("StartPruningJob: %v", err)
	}

	// WithStartImmediately runs the job when added; wait for execution
	time.Sleep(200 * time.Millisecond)

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_history`).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 record after pruning (old removed), got %d", count)
	}
}
