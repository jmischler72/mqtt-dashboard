package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
	"mqtt-dashboard/models"
)

type noopRegistry struct{}

func (noopRegistry) SetSaveSysTopics(_ bool) {}

func newSettingsRouter(h *handlers.SettingsHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/settings", h.GetSettings)
	r.Put("/api/settings", h.UpdateSettings)
	r.Get("/api/settings/history-size", h.GetHistorySize)
	r.Delete("/api/settings/history", h.ClearHistory)
	r.Patch("/api/settings", h.PatchSettings)
	return r
}

func TestGetSettings_Default(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var s models.AppSettings
	decodeJSON(t, rec.Body, &s)
	if s.RetentionPeriodHours != 24 {
		t.Errorf("retention_period_hours = %d, want 24", s.RetentionPeriodHours)
	}
}

func TestUpdateSettings_Success(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	body := jsonBody(t, models.AppSettings{RetentionPeriodHours: 48})
	req := httptest.NewRequest(http.MethodPut, "/api/settings", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var s models.AppSettings
	decodeJSON(t, rec.Body, &s)
	if s.RetentionPeriodHours != 48 {
		t.Errorf("retention_period_hours = %d, want 48", s.RetentionPeriodHours)
	}
}

func TestUpdateSettings_BelowMinimum(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	body := jsonBody(t, models.AppSettings{RetentionPeriodHours: 10})
	req := httptest.NewRequest(http.MethodPut, "/api/settings", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpdateSettings_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetHistorySize_ReturnsZeroOnEmpty(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/settings/history-size", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]int64
	decodeJSON(t, rec.Body, &body)
	if _, ok := body["size_bytes"]; !ok {
		t.Error("response missing size_bytes field")
	}
}

func TestClearHistory_DeletesRecords(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'test/topic', 'hello')`)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/api/settings/history", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	var count int
	db.QueryRow(`SELECT COUNT(*) FROM mqtt_history`).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 records after clear, got %d", count)
	}
}

func TestPatchSettings_UpdateRetentionOnly(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	hours := 48
	body := jsonBody(t, map[string]any{"retention_period_hours": hours})
	req := httptest.NewRequest(http.MethodPatch, "/api/settings", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var s models.AppSettings
	decodeJSON(t, rec.Body, &s)
	if s.RetentionPeriodHours != 48 {
		t.Errorf("retention_period_hours = %d, want 48", s.RetentionPeriodHours)
	}
}

func TestPatchSettings_UpdateSaveSysTopics(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	save := true
	body := jsonBody(t, map[string]any{"save_sys_topics": save})
	req := httptest.NewRequest(http.MethodPatch, "/api/settings", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var s models.AppSettings
	decodeJSON(t, rec.Body, &s)
	if !s.SaveSysTopics {
		t.Error("expected save_sys_topics = true")
	}
}

func TestPatchSettings_NoFields(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	body := jsonBody(t, map[string]any{})
	req := httptest.NewRequest(http.MethodPatch, "/api/settings", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPatchSettings_BelowMinimum(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	body := jsonBody(t, map[string]any{"retention_period_hours": 1})
	req := httptest.NewRequest(http.MethodPatch, "/api/settings", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPatchSettings_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	req := httptest.NewRequest(http.MethodPatch, "/api/settings", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpdateSettings_Persistence(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	body := jsonBody(t, models.AppSettings{RetentionPeriodHours: 72})
	putReq := httptest.NewRequest(http.MethodPut, "/api/settings", body)
	putReq.Header.Set("Content-Type", "application/json")
	putRec := httptest.NewRecorder()
	r.ServeHTTP(putRec, putReq)

	if putRec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200", putRec.Code)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)

	var s models.AppSettings
	decodeJSON(t, getRec.Body, &s)
	if s.RetentionPeriodHours != 72 {
		t.Errorf("after update: retention_period_hours = %d, want 72", s.RetentionPeriodHours)
	}
}

func TestGetSettings_FallbackDefaults(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`DELETE FROM app_settings`) // empty table forces scan error fallback
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var s models.AppSettings
	decodeJSON(t, rec.Body, &s)
	if s.RetentionPeriodHours != 24 || s.SaveSysTopics {
		t.Errorf("expected default settings {24 false}, got %+v", s)
	}
}

func TestPatchSettings_FallbackDefaults(t *testing.T) {
	db := setupTestDB(t)
	db.Exec(`DELETE FROM app_settings`) // empty table
	h := handlers.NewSettingsHandler(db, noopRegistry{})
	r := newSettingsRouter(h)

	save := true
	body := jsonBody(t, map[string]any{"save_sys_topics": save})
	req := httptest.NewRequest(http.MethodPatch, "/api/settings", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
