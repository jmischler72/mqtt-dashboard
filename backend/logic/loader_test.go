package logic_test

import (
	"testing"

	"mqtt-dashboard/db"
	"mqtt-dashboard/logic"
)

func TestLoadRulesFromDB(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	// Nil safety
	logic.LoadRulesFromDB(nil, engine)
	logic.LoadRulesFromDB(database, nil)

	// Insert various layouts: valid logic, invalid json, empty topics, non-logic panel
	_, err = database.Exec(`
		INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, config_json, broker_id)
		VALUES 
			('p1', 'default', 'Logic 1', 'logic', '{"source_topic":"sensors/temp","target_topic":"fan/set","payload":"ON","enabled":true}', 'b1'),
			('p2', 'default', 'Logic Bad JSON', 'logic', 'invalid json', 'b1'),
			('p3', 'default', 'Logic Empty Source', 'logic', '{"source_topic":""}', 'b1'),
			('p4', 'default', 'Button Panel', 'button', '{}', 'b1')
	`)
	if err != nil {
		t.Fatalf("insert layouts: %v", err)
	}

	logic.LoadRulesFromDB(database, engine)

	if _, ok := engine.GetRule("p1"); !ok {
		t.Error("expected rule p1 to be loaded")
	}
	if _, ok := engine.GetRule("p2"); ok {
		t.Error("expected rule p2 not to be loaded")
	}

	// Test with closed DB
	dbClosed, _ := db.InitDB(":memory:")
	dbClosed.Close()
	logic.LoadRulesFromDB(dbClosed, engine)
}

func TestClearAllRules(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	rule := logic.Rule{
		PanelID:     "p1",
		SourceTopic: "sensors/temp",
		TargetTopic: "fan/set",
		Payload:     "ON",
		Enabled:     true,
	}
	if err := engine.AddRule(&rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	engine.ClearAllRules()

	if _, ok := engine.GetRule("p1"); ok {
		t.Error("expected rule p1 to be cleared")
	}
}
