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

func newDashboardRouter(h *handlers.DashboardHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/dashboards", h.ListDashboards)
	r.Post("/api/dashboards", h.CreateDashboard)
	r.Put("/api/dashboards/{id}", h.RenameDashboard)
	r.Delete("/api/dashboards/{id}", h.DeleteDashboard)
	return r
}

func TestListDashboards_HasDefault(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/dashboards", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var dashboards []models.Dashboard
	decodeJSON(t, rec.Body, &dashboards)
	if len(dashboards) != 1 || dashboards[0].ID != "default" {
		t.Errorf("expected [{default ...}], got %v", dashboards)
	}
}

func TestCreateDashboard_Success(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	body := jsonBody(t, map[string]string{"name": "My Dashboard"})
	req := httptest.NewRequest(http.MethodPost, "/api/dashboards", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var d models.Dashboard
	decodeJSON(t, rec.Body, &d)
	if d.Name != "My Dashboard" {
		t.Errorf("name = %q, want 'My Dashboard'", d.Name)
	}
	if d.ID == "" {
		t.Error("expected non-empty ID")
	}
}

func TestCreateDashboard_MissingName(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	body := jsonBody(t, map[string]string{})
	req := httptest.NewRequest(http.MethodPost, "/api/dashboards", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestRenameDashboard_Success(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(database, sched)
	r := newDashboardRouter(h)

	body := jsonBody(t, map[string]string{"name": "Renamed"})
	req := httptest.NewRequest(http.MethodPut, "/api/dashboards/default", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var d models.Dashboard
	decodeJSON(t, rec.Body, &d)
	if d.Name != "Renamed" {
		t.Errorf("name = %q, want 'Renamed'", d.Name)
	}
}

func TestDeleteDashboard_LastDashboard_Blocked(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/api/dashboards/default", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestDeleteDashboard_RemovesPanels(t *testing.T) {
	database := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(database, sched)
	r := newDashboardRouter(h)

	// Add a second dashboard so we can delete one
	database.Exec(`INSERT INTO dashboards (id, name) VALUES ('d2', 'Second')`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p1', 'd2', 'P', 'button', 0, 0, 4, 4)`)

	req := httptest.NewRequest(http.MethodDelete, "/api/dashboards/d2", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE dashboard_id='d2'`).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 panels after cascade delete, got %d", count)
	}
}

func TestDeleteDashboard_NotFound(t *testing.T) {
	db := setupTestDB(t)
	// Add second dashboard first so we're not blocked by last-dashboard check
	db.Exec(`INSERT INTO dashboards (id, name) VALUES ('d2', 'Second')`)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/api/dashboards/nonexistent", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRenameDashboard_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/dashboards/default", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestRenameDashboard_MissingName(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	body := jsonBody(t, map[string]any{"name": ""})
	req := httptest.NewRequest(http.MethodPut, "/api/dashboards/default", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestRenameDashboard_NotFound(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	body := jsonBody(t, map[string]any{"name": "New Name"})
	req := httptest.NewRequest(http.MethodPut, "/api/dashboards/nonexistent", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestCreateDashboard_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	sched := newMockScheduler()
	h := handlers.NewDashboardHandler(db, sched)
	r := newDashboardRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/dashboards", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
