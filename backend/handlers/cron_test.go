package handlers_test

import (
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
	r.Put("/api/cron/{panelId}", h.UpsertCron)
	r.Delete("/api/cron/{panelId}", h.DeleteCron)
	r.Put("/api/cron/{panelId}/toggle", h.ToggleCron)
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
	req := httptest.NewRequest(http.MethodPut, "/api/cron/panel1", body)
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

	req := httptest.NewRequest(http.MethodGet, "/api/cron/panel1/status", nil)
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
