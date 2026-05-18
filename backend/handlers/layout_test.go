package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
	"mqtt-dashboard/models"
)

func newLayoutRouter(h *handlers.LayoutHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/layouts", h.GetLayouts)
	r.Post("/api/layouts", h.CreatePanel)
	r.Put("/api/layouts/{id}", h.UpdatePanel)
	r.Delete("/api/layouts/{id}", h.DeletePanel)
	r.Put("/api/layouts/batch", h.BatchUpdatePositions)
	return r
}

func TestGetLayouts_Empty(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/layouts", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var panels []models.DashboardPanel
	decodeJSON(t, rec.Body, &panels)
	if len(panels) != 0 {
		t.Errorf("expected empty list, got %d panels", len(panels))
	}
}

func TestCreatePanel_Success(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	body := jsonBody(t, map[string]string{
		"dashboard_id": "default",
		"panel_type":   "button",
		"title":        "My Button",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/layouts", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var p models.DashboardPanel
	decodeJSON(t, rec.Body, &p)
	if p.PanelType != "button" {
		t.Errorf("panel_type = %q, want 'button'", p.PanelType)
	}
	if p.ID == "" {
		t.Error("panel ID should not be empty")
	}
}

func TestCreatePanel_MissingType(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	body := jsonBody(t, map[string]string{"dashboard_id": "default"})
	req := httptest.NewRequest(http.MethodPost, "/api/layouts", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestCreatePanel_MissingDashboard(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	body := jsonBody(t, map[string]string{"panel_type": "button"})
	req := httptest.NewRequest(http.MethodPost, "/api/layouts", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetLayouts_FilterByDashboard(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewLayoutHandler(database)
	r := newLayoutRouter(h)

	// create two panels in different dashboards
	database.Exec(`INSERT INTO dashboards (id, name) VALUES ('d2', 'Second')`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p1', 'default', 'P1', 'button', 0, 0, 4, 4)`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p2', 'd2', 'P2', 'log', 0, 0, 4, 4)`)

	req := httptest.NewRequest(http.MethodGet, "/api/layouts?dashboard_id=default", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var panels []models.DashboardPanel
	decodeJSON(t, rec.Body, &panels)
	if len(panels) != 1 {
		t.Errorf("expected 1 panel, got %d", len(panels))
	}
	if len(panels) > 0 && panels[0].DashboardID != "default" {
		t.Errorf("dashboard_id = %q, want 'default'", panels[0].DashboardID)
	}
}

func TestUpdatePanel_Success(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewLayoutHandler(database)
	r := newLayoutRouter(h)

	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p1', 'default', 'Old', 'button', 0, 0, 4, 4)`)

	newTitle := "Updated"
	body := jsonBody(t, map[string]any{"title": newTitle, "w": 6})
	req := httptest.NewRequest(http.MethodPut, "/api/layouts/p1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var p models.DashboardPanel
	decodeJSON(t, rec.Body, &p)
	if p.Title != newTitle {
		t.Errorf("title = %q, want %q", p.Title, newTitle)
	}
	if p.W != 6 {
		t.Errorf("w = %d, want 6", p.W)
	}
}

func TestUpdatePanel_NotFound(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	body := jsonBody(t, map[string]string{"title": "x"})
	req := httptest.NewRequest(http.MethodPut, "/api/layouts/nonexistent", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestUpdatePanel_AllOptionalFields(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewLayoutHandler(database)
	r := newLayoutRouter(h)

	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p1', 'default', 'Old', 'input', 0, 0, 4, 4)`)

	x, y, w, hv := 1, 2, 6, 8
	brokerID := "broker1"
	body := jsonBody(t, map[string]any{
		"title":     "New",
		"x":         x,
		"y":         y,
		"w":         w,
		"h":         hv,
		"broker_id": brokerID,
	})
	req := httptest.NewRequest(http.MethodPut, "/api/layouts/p1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var p models.DashboardPanel
	decodeJSON(t, rec.Body, &p)
	if p.Title != "New" || p.X != x || p.Y != y || p.W != w || p.H != hv || p.BrokerID != brokerID {
		t.Errorf("unexpected panel state: %+v", p)
	}
}

func TestDeletePanel_Success(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewLayoutHandler(database)
	r := newLayoutRouter(h)

	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p1', 'default', 'X', 'button', 0, 0, 4, 4)`)

	req := httptest.NewRequest(http.MethodDelete, "/api/layouts/p1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}

	// verify gone
	var count int
	database.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE id='p1'`).Scan(&count)
	if count != 0 {
		t.Error("panel still exists after delete")
	}
}

func TestDeletePanel_NotFound(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/api/layouts/missing", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestBatchUpdatePositions(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewLayoutHandler(database)
	r := newLayoutRouter(h)

	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p1', 'default', 'A', 'button', 0, 0, 4, 4)`)
	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p2', 'default', 'B', 'log', 0, 4, 4, 4)`)

	body := jsonBody(t, map[string]any{
		"panels": []map[string]any{
			{"id": "p1", "x": 2, "y": 3, "w": 6, "h": 5},
			{"id": "p2", "x": 0, "y": 8, "w": 4, "h": 4},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/layouts/batch", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}

	var x, y, w, hv int
	database.QueryRow(`SELECT x, y, w, h FROM dashboard_layouts WHERE id='p1'`).Scan(&x, &y, &w, &hv)
	if x != 2 || y != 3 || w != 6 || hv != 5 {
		t.Errorf("p1 position = {%d %d %d %d}, want {2 3 6 5}", x, y, w, hv)
	}
}

func TestCreatePanel_DefaultTitle(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	body := jsonBody(t, map[string]string{
		"dashboard_id": "default",
		"panel_type":   "log",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/layouts", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	var p models.DashboardPanel
	decodeJSON(t, rec.Body, &p)
	if p.Title != "New Panel" {
		t.Errorf("title = %q, want 'New Panel'", p.Title)
	}
}

func TestUpdatePanel_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/layouts/p1", strings.NewReader("{bad json}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestBatchUpdatePositions_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewLayoutHandler(db)
	r := newLayoutRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/layouts/batch", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpdatePanel_ConfigJSON(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewLayoutHandler(database)
	r := newLayoutRouter(h)

	database.Exec(`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h) VALUES ('p1', 'default', 'X', 'button', 0, 0, 4, 4)`)

	cfg := json.RawMessage(`{"color":"red"}`)
	body := jsonBody(t, map[string]any{"config_json": cfg})
	req := httptest.NewRequest(http.MethodPut, "/api/layouts/p1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var p models.DashboardPanel
	decodeJSON(t, rec.Body, &p)
	if string(p.ConfigJSON) != `{"color":"red"}` {
		t.Errorf("config_json = %s, want %s", p.ConfigJSON, `{"color":"red"}`)
	}
}
