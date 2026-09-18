package handlers_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
)

func newCronRouter(h *handlers.CronHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/cron", h.ListCronJobs)
	r.Post("/api/cron/{panelId}", h.UpsertCron)
	r.Put("/api/cron/{panelId}", h.UpsertCron)
	r.Delete("/api/cron/{panelId}", h.DeleteCron)
	r.Put("/api/cron/{panelId}/toggle", h.ToggleCron)
	r.Get("/api/cron/{panelId}", h.GetCronStatus)
	r.Get("/api/cron/{panelId}/status", h.GetCronStatus)
	return r
}

func TestUpsertCron_Success(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('panel1', 'default', 'P', 'cron', 0, 0, 4, 4)`)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	body := jsonBody(t, map[string]any{
		"cron_expr": "*/5 * * * *",
		"topic":     "test/pub",
		"payload":   "ping",
		"enabled":   true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/cron/panel1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if sched.addCalls != 1 {
		t.Errorf("AddJob calls = %d, want 1", sched.addCalls)
	}
	info, ok := sched.GetJob("panel1")
	if !ok {
		t.Fatal("expected job in scheduler")
	}
	if info.Topic != "test/pub" {
		t.Errorf("topic = %q, want 'test/pub'", info.Topic)
	}
}

func TestUpsertCron_MissingFields(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	body := jsonBody(t, map[string]string{"cron_expr": "*/5 * * * *"}) // missing topic
	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpsertCron_WildcardRejected(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	for _, wildcardTopic := range []string{"sensors/#", "home/+/temp", "#", "+"} {
		body := jsonBody(t, map[string]any{
			"cron_expr": "*/5 * * * *",
			"topic":     wildcardTopic,
		})
		req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("topic %q: status = %d, want 400", wildcardTopic, rec.Code)
		}
	}
}

func TestUpsertCron_SchedulerError(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	sched.addErr = errors.New("invalid cron expression")
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	body := jsonBody(t, map[string]string{
		"cron_expr": "bad",
		"topic":     "x",
	})
	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestDeleteCron_Success(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	sched.AddJob("panel1", "", "*/5 * * * *", "t", "p", 0, false, true) //nolint
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/api/cron/panel1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if _, ok := sched.GetJob("panel1"); ok {
		t.Error("job should be removed after delete")
	}
}

func TestToggleCron_Success(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('panel1', 'default', 'P', 'cron', 0, 0, 4, 4)`)
	sched := newMockScheduler()
	sched.AddJob("panel1", "", "*/5 * * * *", "t", "p", 0, false, true) //nolint
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	body := jsonBody(t, map[string]bool{"enabled": false})
	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1/toggle", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	info, _ := sched.GetJob("panel1")
	if info.Enabled {
		t.Error("job should be disabled after toggle")
	}
}

func TestGetCronStatus_Success(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	sched.AddJob("panel1", "broker1", "*/10 * * * *", "my/topic", "data", 0, false, true) //nolint
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/cron/panel1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var result map[string]any
	decodeJSON(t, rec.Body, &result)
	if result["topic"] != "my/topic" {
		t.Errorf("topic = %v, want 'my/topic'", result["topic"])
	}
}

func TestGetCronStatus_NotFound(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/cron/missing/status", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestUpsertCron_InvalidJSON(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestToggleCron_InvalidJSON(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1/toggle", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestToggleCron_RecoverFromDB(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel1', 'default', 'P', 'cron', 0, 0, 4, 4, '{"cron_expr":"*/5 * * * *","topic":"recovered/topic","enabled":false}', 'b1')`)
	sched := newMockScheduler() // Empty scheduler - not in memory!
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	body := jsonBody(t, map[string]bool{"enabled": true})
	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1/toggle", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	info, ok := sched.GetJob("panel1")
	if !ok {
		t.Fatal("expected job to be registered into scheduler after toggle recovery")
	}
	if !info.Enabled {
		t.Error("job should be enabled")
	}
	if info.Topic != "recovered/topic" {
		t.Errorf("topic = %q, want 'recovered/topic'", info.Topic)
	}
}

func TestGetCronStatus_RecoverFromDB(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel1', 'default', 'P', 'cron', 0, 0, 4, 4, '{"cron_expr":"*/10 * * * *","topic":"recovered/status","enabled":true}', 'b1')`)
	sched := newMockScheduler() // Empty scheduler
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/cron/panel1/status", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var result map[string]any
	decodeJSON(t, rec.Body, &result)
	if result["topic"] != "recovered/status" {
		t.Errorf("topic = %v, want 'recovered/status'", result["topic"])
	}
}

func TestToggleCron_SchedulerError(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	sched.toggleErr = errors.New("toggle failed")
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	body := jsonBody(t, map[string]bool{"enabled": false})
	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1/toggle", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestListCronJobs_Empty(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/cron", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var jobs []handlers.ScheduledJobItem
	decodeJSON(t, rec.Body, &jobs)
	if len(jobs) != 0 {
		t.Errorf("len(jobs) = %d, want 0", len(jobs))
	}
}

func TestListCronJobs_Success(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order) VALUES ('b1', 'Test Broker 1', 'localhost', 1883, 1, 0)`)
	database.Exec(`INSERT INTO dashboards (id, name) VALUES ('dash1', 'Kitchen')`)

	// Configured enabled job
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel1', 'dash1', 'Cron 1', 'cron', 0, 0, 4, 4, '{"cron_expr":"*/5 * * * *","topic":"kitchen/light","payload":"on","qos":1,"retain":true,"enabled":true}', 'b1')`)
	// Configured disabled job
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel2', 'dash1', 'Cron 2', 'cron', 0, 4, 4, 4, '{"cron_expr":"0 * * * *","topic":"kitchen/fan","payload":"off","qos":0,"retain":false,"enabled":false}', 'b1')`)
	// Unconfigured cron panel (no cron_expr, no topic)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel3', 'dash1', 'Cron 3', 'cron', 0, 8, 4, 4, '{}', 'b1')`)
	// Non-cron panel
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel4', 'dash1', 'Button 1', 'button', 4, 0, 4, 4, '{}', 'b1')`)

	sched := newMockScheduler()
	sched.AddJob("panel1", "b1", "*/5 * * * *", "kitchen/light", "on", 1, true, true) //nolint

	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/cron", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var jobs []handlers.ScheduledJobItem
	decodeJSON(t, rec.Body, &jobs)

	// panel3 (unconfigured) and panel4 (button) should be excluded
	if len(jobs) != 2 {
		t.Fatalf("got %d jobs, want 2", len(jobs))
	}

	j1 := jobs[0]
	if j1.PanelID != "panel1" || j1.PanelTitle != "Cron 1" {
		t.Errorf("unexpected job 0: %+v", j1)
	}
	if j1.DashboardName != "Kitchen" {
		t.Errorf("DashboardName = %q, want 'Kitchen'", j1.DashboardName)
	}
	if j1.BrokerName != "Test Broker 1" {
		t.Errorf("BrokerName = %q, want 'Test Broker 1'", j1.BrokerName)
	}
	if !j1.Enabled {
		t.Errorf("panel1 should be enabled")
	}
	if j1.Topic != "kitchen/light" || j1.Payload != "on" || j1.QoS != 1 || !j1.Retain {
		t.Errorf("unexpected panel1 properties: %+v", j1)
	}

	j2 := jobs[1]
	if j2.PanelID != "panel2" || j2.PanelTitle != "Cron 2" {
		t.Errorf("unexpected job 1: %+v", j2)
	}
	if j2.Enabled {
		t.Errorf("panel2 should be disabled")
	}
}

func TestListCronJobs_FilterEnabled(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order) VALUES ('b1', 'Test Broker 1', 'localhost', 1883, 1, 0)`)
	database.Exec(`INSERT INTO dashboards (id, name) VALUES ('dash1', 'Kitchen')`)

	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel1', 'dash1', 'Cron 1', 'cron', 0, 0, 4, 4, '{"cron_expr":"*/5 * * * *","topic":"kitchen/light","enabled":true}', 'b1')`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel2', 'dash1', 'Cron 2', 'cron', 0, 4, 4, 4, '{"cron_expr":"0 * * * *","topic":"kitchen/fan","enabled":false}', 'b1')`)

	sched := newMockScheduler()
	sched.AddJob("panel1", "b1", "*/5 * * * *", "kitchen/light", "", 0, false, true) //nolint

	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/cron?enabled=true", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var jobs []handlers.ScheduledJobItem
	decodeJSON(t, rec.Body, &jobs)

	if len(jobs) != 1 {
		t.Fatalf("got %d jobs, want 1", len(jobs))
	}
	if jobs[0].PanelID != "panel1" {
		t.Errorf("got job ID %q, want 'panel1'", jobs[0].PanelID)
	}
}

func TestUpsertAndToggleCron_PreservesMetadata(t *testing.T) {
	database := setupTestDB(t)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES ('panel1', 'default', 'Cron', 'cron', 0, 0, 4, 4, '{"cron_expr":"*/5 * * * *","topic":"t","header_meta_pinned":true,"enabled":true}', 'b1')`)
	sched := newMockScheduler()
	h := handlers.NewCronHandler(database, sched)
	r := newCronRouter(h)

	// 1. UpsertCron updates cron fields but preserves header_meta_pinned
	body := jsonBody(t, map[string]any{
		"cron_expr": "*/10 * * * *",
		"topic":     "updated/topic",
		"enabled":   true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/cron/panel1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("upsert status = %d, want 200", rec.Code)
	}

	var cfgStr string
	database.QueryRow(`SELECT config_json FROM dashboard_layouts WHERE id = 'panel1'`).Scan(&cfgStr)
	var cfgMap map[string]any
	json.Unmarshal([]byte(cfgStr), &cfgMap)
	if cfgMap["header_meta_pinned"] != true {
		t.Errorf("header_meta_pinned was lost after UpsertCron, got %v", cfgMap["header_meta_pinned"])
	}
	if cfgMap["topic"] != "updated/topic" {
		t.Errorf("topic = %v, want 'updated/topic'", cfgMap["topic"])
	}

	// 2. ToggleCron preserves header_meta_pinned
	toggleBody := jsonBody(t, map[string]bool{"enabled": false})
	toggleReq := httptest.NewRequest(http.MethodPut, "/api/cron/panel1/toggle", toggleBody)
	toggleReq.Header.Set("Content-Type", "application/json")
	toggleRec := httptest.NewRecorder()
	r.ServeHTTP(toggleRec, toggleReq)

	if toggleRec.Code != http.StatusOK {
		t.Fatalf("toggle status = %d, want 200", toggleRec.Code)
	}

	database.QueryRow(`SELECT config_json FROM dashboard_layouts WHERE id = 'panel1'`).Scan(&cfgStr)
	json.Unmarshal([]byte(cfgStr), &cfgMap)
	if cfgMap["header_meta_pinned"] != true {
		t.Errorf("header_meta_pinned was lost after ToggleCron, got %v", cfgMap["header_meta_pinned"])
	}
	if cfgMap["enabled"] != false {
		t.Errorf("enabled = %v, want false", cfgMap["enabled"])
	}
}

