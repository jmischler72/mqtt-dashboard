package cron_test

import (
	"testing"

	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
)

func TestLoadJobsFromDB(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	pub := &mockPublisher{defaultID: "def-broker"}
	scheduler, err := cron.NewScheduler(pub)
	if err != nil {
		t.Fatalf("NewScheduler: %v", err)
	}

	// Nil safety
	cron.LoadJobsFromDB(nil, scheduler)
	cron.LoadJobsFromDB(database, nil)

	// Insert various layouts: valid cron, invalid json, empty cron_expr, non-cron panel
	_, err = database.Exec(`
		INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, config_json, broker_id)
		VALUES 
			('p1', 'default', 'Cron 1', 'cron', '{"cron_expr":"*/5 * * * *","topic":"test","payload":"hi","qos":0,"retain":false,"enabled":true}', 'b1'),
			('p2', 'default', 'Cron Bad JSON', 'cron', 'invalid json', 'b1'),
			('p3', 'default', 'Cron Empty Expr', 'cron', '{"cron_expr":""}', 'b1'),
			('p4', 'default', 'Button Panel', 'button', '{}', 'b1')
	`)
	if err != nil {
		t.Fatalf("insert layouts: %v", err)
	}

	cron.LoadJobsFromDB(database, scheduler)

	if _, ok := scheduler.GetJob("p1"); !ok {
		t.Error("expected job p1 to be loaded")
	}
	if _, ok := scheduler.GetJob("p2"); ok {
		t.Error("expected job p2 not to be loaded")
	}

	// Test with closed DB
	dbClosed, _ := db.InitDB(":memory:")
	dbClosed.Close()
	cron.LoadJobsFromDB(dbClosed, scheduler)
}
