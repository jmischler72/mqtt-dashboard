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
	qos      byte
	retain   bool
}

func (m *mockPublisher) Publish(brokerID, topic string, qos byte, retain bool, payload []byte) error {
	m.calls = append(m.calls, publishCall{brokerID, topic, payload, qos, retain})
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

	err := sc.AddJob("panel1", "b1", "*/5 * * * *", "test/topic", "ping", 0, false, false)
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

	err := sc.AddJob("panel1", "b1", "*/5 * * * *", "test/topic", "ping", 0, false, true)
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

	err := sc.AddJob("panel1", "b1", "not-a-cron", "t", "p", 0, false, true)
	if err == nil {
		t.Error("expected error for invalid cron expression")
	}
}

// A disabled job with an out-of-range field (e.g. day-of-month 0) must be
// rejected up front, not silently stored and left to fail on later toggle.
func TestAddJob_InvalidCronExpressionDisabled(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	err := sc.AddJob("panel1", "b1", "0 0 0 * 0", "t", "p", 0, false, false)
	if err == nil {
		t.Fatal("expected error for invalid cron expression when disabled")
	}
	if _, ok := sc.GetJob("panel1"); ok {
		t.Error("invalid job should not be stored")
	}
}

// A failed AddJob must not delete the previously registered valid job.
func TestAddJob_InvalidDoesNotClobberExisting(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	if err := sc.AddJob("panel1", "b1", "*/5 * * * *", "t", "p", 0, false, true); err != nil {
		t.Fatalf("initial AddJob: %v", err)
	}
	if err := sc.AddJob("panel1", "b1", "0 0 0 * 0", "t", "p", 0, false, true); err == nil {
		t.Fatal("expected error for invalid cron expression")
	}
	info, ok := sc.GetJob("panel1")
	if !ok {
		t.Fatal("existing valid job should survive a failed re-add")
	}
	if info.CronExpr != "*/5 * * * *" {
		t.Errorf("cron_expr = %q, want original '*/5 * * * *'", info.CronExpr)
	}
}

func TestValidateCronExpr(t *testing.T) {
	if err := cron.ValidateCronExpr("0 0 * * 0"); err != nil {
		t.Errorf("valid weekly expr rejected: %v", err)
	}
	if err := cron.ValidateCronExpr("0 0 0 * 0"); err == nil {
		t.Error("expected error for day-of-month 0")
	}
}

func TestAddJob_ReplacesExisting(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	sc.AddJob("panel1", "b1", "*/5 * * * *", "old/topic", "p", 0, false, false)  //nolint
	sc.AddJob("panel1", "b1", "*/10 * * * *", "new/topic", "p", 0, false, false) //nolint

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

	sc.AddJob("panel1", "b1", "*/5 * * * *", "t", "p", 0, false, false) //nolint
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

	sc.AddJob("panel1", "b1", "*/5 * * * *", "t", "p", 0, false, false) //nolint

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

func TestAddJob_WildcardTopicRejected(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	if err := sc.AddJob("p1", "b1", "* * * * *", "topic/+/sub", "data", 0, false, true); err == nil {
		t.Error("expected error for '+' wildcard in topic")
	}
	if err := sc.AddJob("p1", "b1", "* * * * *", "topic/#", "data", 0, false, true); err == nil {
		t.Error("expected error for '#' wildcard in topic")
	}
}

func TestToggleJob_DisableEnabled(t *testing.T) {
	pub := &mockPublisher{}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	sc.AddJob("panel1", "b1", "*/5 * * * *", "t", "p", 0, false, true) //nolint

	if err := sc.ToggleJob("panel1", false); err != nil {
		t.Fatalf("ToggleJob: %v", err)
	}

	info, _ := sc.GetJob("panel1")
	if info.Enabled {
		t.Error("job should be disabled after toggle")
	}
}

func TestScheduler_JobExecution(t *testing.T) {
	pub := &mockPublisher{defaultID: "def-broker"}
	sc, _ := cron.NewScheduler(pub)
	sc.Start()
	defer sc.Stop()

	// Every 1 second cron expression (gocron 6 fields or 5 fields: standard 5 fields is minute, gocron supports 5 fields)
	// We can add an enabled job with empty brokerID and comma-separated topics
	err := sc.AddJob("panel-exec", "", "* * * * *", "topic1, topic2", "hello", 1, true, true)
	if err != nil {
		t.Fatalf("AddJob: %v", err)
	}

	info, ok := sc.GetJob("panel-exec")
	if !ok || !info.Enabled {
		t.Fatalf("job not retrieved or not enabled")
	}
	if info.NextRun.IsZero() {
		t.Error("expected non-zero NextRun time")
	}
}
