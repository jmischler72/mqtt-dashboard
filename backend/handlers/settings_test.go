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
