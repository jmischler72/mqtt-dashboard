package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
	"mqtt-dashboard/logic"
)

func newAutomationsRouter(h *handlers.AutomationsHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/automations", h.ListAutomations)
	r.Put("/api/automations/{panelId}/toggle", h.ToggleAutomation)
	return r
}

func TestListAutomations_Empty(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	logicEng := newMockLogicEngine()
	cronProv := handlers.NewCronAutomationProvider(database, sched)
	logicProv := handlers.NewLogicAutomationProvider(database, logicEng)
	h := handlers.NewAutomationsHandler(database, cronProv, logicProv)
	r := newAutomationsRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/automations", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var items []handlers.AutomationItem
	decodeJSON(t, rec.Body, &items)
	if len(items) != 0 {
		t.Errorf("len(items) = %d, want 0", len(items))
	}
}

func TestListAutomations_Success(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order) VALUES ('b1', 'Test Broker 1', 'localhost', 1883, 1, 0)`)
	database.Exec(`INSERT INTO dashboards (id, name) VALUES ('dash1', 'Living Room')`)

	// 1. Configured enabled cron job
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel1', 'dash1', 'Cron Job 1', 'cron', 0, 0, 4, 4, '{"cron_expr":"*/5 * * * *","topic":"cron/out","payload":"ping","qos":1,"retain":true,"enabled":true}', 'b1')`)

	// 2. Configured enabled logic rule
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel2', 'dash1', 'Logic Rule 1', 'logic', 0, 4, 4, 4, '{"source_topic":"sensor/temp","target_topic":"actuator/fan","mode":"on_change","payload":"1","qos":0,"retain":false,"enabled":true,"conditions":[{"topic":"sensor/temp","operator":"gt","value":"25"}]}', 'b1')`)

	// 3. Unconfigured cron panel (excluded)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel3', 'dash1', 'Cron Unconf', 'cron', 0, 8, 4, 4, '{}', 'b1')`)

	// 4. Unconfigured logic panel (excluded)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel4', 'dash1', 'Logic Unconf', 'logic', 0, 12, 4, 4, '{}', 'b1')`)

	// 5. Non-automation panel like button (excluded)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel5', 'dash1', 'Button 1', 'button', 4, 0, 4, 4, '{}', 'b1')`)

	sched := newMockScheduler()
	sched.AddJob("panel1", "b1", "*/5 * * * *", "cron/out", "ping", 1, true, true) //nolint

	logicEng := newMockLogicEngine()
	rule := &logic.Rule{
		PanelID:     "panel2",
		BrokerID:    "b1",
		SourceTopic: "sensor/temp",
		TargetTopic: "actuator/fan",
		Mode:        "on_change",
		Enabled:     true,
	}
	logicEng.AddRule(rule) //nolint
	// Add mock rule status with fired telemetry
	now := time.Now()
	logicEng.GetStatus("panel2") // Ensure initialized
	st, _ := logicEng.GetStatus("panel2")
	st.LastFired = &now
	st.FireCount = 7
	st.CurrentState = "idle"

	cronProv := handlers.NewCronAutomationProvider(database, sched)
	logicProv := handlers.NewLogicAutomationProvider(database, logicEng)
	h := handlers.NewAutomationsHandler(database, cronProv, logicProv)
	r := newAutomationsRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/automations", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var items []handlers.AutomationItem
	decodeJSON(t, rec.Body, &items)

	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}

	cronItem := items[0]
	if cronItem.PanelID != "panel1" || cronItem.PanelType != "cron" {
		t.Errorf("unexpected cron item: %+v", cronItem)
	}
	if cronItem.TargetTopic != "cron/out" {
		t.Errorf("TargetTopic = %q, want 'cron/out'", cronItem.TargetTopic)
	}
	if cronItem.TriggerType != "schedule" {
		t.Errorf("TriggerType = %q, want 'schedule'", cronItem.TriggerType)
	}
	if cronItem.TriggerSummary != "*/5 * * * *" {
		t.Errorf("TriggerSummary = %q, want '*/5 * * * *'", cronItem.TriggerSummary)
	}

	logicItem := items[1]
	if logicItem.PanelID != "panel2" || logicItem.PanelType != "logic" {
		t.Errorf("unexpected logic item: %+v", logicItem)
	}
	if logicItem.SourceTopic != "sensor/temp" {
		t.Errorf("SourceTopic = %q, want 'sensor/temp'", logicItem.SourceTopic)
	}
	if logicItem.TargetTopic != "actuator/fan" {
		t.Errorf("TargetTopic = %q, want 'actuator/fan'", logicItem.TargetTopic)
	}
	if logicItem.TriggerType != "event" {
		t.Errorf("TriggerType = %q, want 'event'", logicItem.TriggerType)
	}
	if logicItem.TriggerSummary != "on_change" {
		t.Errorf("TriggerSummary = %q, want 'on_change'", logicItem.TriggerSummary)
	}
	if logicItem.TriggerDetail != "1 condition" {
		t.Errorf("TriggerDetail = %q, want '1 condition'", logicItem.TriggerDetail)
	}
	if len(logicItem.Conditions) != 1 {
		t.Errorf("len(Conditions) = %d, want 1", len(logicItem.Conditions))
	}
}

func TestListAutomations_FilterEnabled(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order) VALUES ('b1', 'Test Broker 1', 'localhost', 1883, 1, 0)`)
	database.Exec(`INSERT INTO dashboards (id, name) VALUES ('dash1', 'Dashboard')`)

	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel1', 'dash1', 'Cron Active', 'cron', 0, 0, 4, 4, '{"cron_expr":"* * * * *","topic":"t1","enabled":true}', 'b1')`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel2', 'dash1', 'Cron Paused', 'cron', 0, 4, 4, 4, '{"cron_expr":"* * * * *","topic":"t2","enabled":false}', 'b1')`)

	sched := newMockScheduler()
	sched.AddJob("panel1", "b1", "* * * * *", "t1", "", 0, false, true)  //nolint
	sched.AddJob("panel2", "b1", "* * * * *", "t2", "", 0, false, false) //nolint

	h := handlers.NewAutomationsHandler(database, handlers.NewCronAutomationProvider(database, sched))
	r := newAutomationsRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/automations?enabled=true", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var items []handlers.AutomationItem
	decodeJSON(t, rec.Body, &items)

	if len(items) != 1 {
		t.Fatalf("len(items) = %d, want 1", len(items))
	}
	if items[0].PanelID != "panel1" {
		t.Errorf("PanelID = %q, want 'panel1'", items[0].PanelID)
	}
}

func TestToggleAutomation(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order) VALUES ('b1', 'Broker', 'localhost', 1883, 1, 0)`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('cron1', 'dash', 'Cron', 'cron', 0, 0, 4, 4, '{"cron_expr":"* * * * *","topic":"c","enabled":true}', 'b1')`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('logic1', 'dash', 'Logic', 'logic', 0, 4, 4, 4, '{"source_topic":"s","target_topic":"t","enabled":true}', 'b1')`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('button1', 'dash', 'Btn', 'button', 0, 8, 4, 4, '{}', 'b1')`)

	sched := newMockScheduler()
	sched.AddJob("cron1", "b1", "* * * * *", "c", "", 0, false, true) //nolint
	logicEng := newMockLogicEngine()
	logicEng.AddRule(&logic.Rule{PanelID: "logic1", BrokerID: "b1", SourceTopic: "s", TargetTopic: "t", Enabled: true}) //nolint

	h := handlers.NewAutomationsHandler(database,
		handlers.NewCronAutomationProvider(database, sched),
		handlers.NewLogicAutomationProvider(database, logicEng),
	)
	r := newAutomationsRouter(h)

	// 1. Toggle cron1 to false
	toggleReq := httptest.NewRequest(http.MethodPut, "/api/automations/cron1/toggle", jsonBody(t, map[string]bool{"enabled": false}))
	toggleReq.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, toggleReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("cron toggle status = %d, want 200", rec.Code)
	}
	cronJob, _ := sched.GetJob("cron1")
	if cronJob.Enabled {
		t.Errorf("expected cronJob to be paused")
	}

	// 2. Toggle logic1 to false
	toggleLogicReq := httptest.NewRequest(http.MethodPut, "/api/automations/logic1/toggle", jsonBody(t, map[string]bool{"enabled": false}))
	toggleLogicReq.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, toggleLogicReq)
	if rec2.Code != http.StatusOK {
		t.Fatalf("logic toggle status = %d, want 200", rec2.Code)
	}
	logicRule, _ := logicEng.GetRule("logic1")
	if logicRule.Enabled {
		t.Errorf("expected logicRule to be paused")
	}

	// 3. Toggle button1 (unsupported automation type)
	toggleBtnReq := httptest.NewRequest(http.MethodPut, "/api/automations/button1/toggle", jsonBody(t, map[string]bool{"enabled": false}))
	toggleBtnReq.Header.Set("Content-Type", "application/json")
	rec3 := httptest.NewRecorder()
	r.ServeHTTP(rec3, toggleBtnReq)
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("button toggle status = %d, want 400", rec3.Code)
	}

	// 4. Toggle nonexistent panel
	toggleNoneReq := httptest.NewRequest(http.MethodPut, "/api/automations/nonexistent/toggle", jsonBody(t, map[string]bool{"enabled": false}))
	toggleNoneReq.Header.Set("Content-Type", "application/json")
	rec4 := httptest.NewRecorder()
	r.ServeHTTP(rec4, toggleNoneReq)
	if rec4.Code != http.StatusNotFound {
		t.Fatalf("nonexistent toggle status = %d, want 404", rec4.Code)
	}
}
