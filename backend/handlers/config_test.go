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

func newBrokerRouter(h *handlers.BrokerHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/brokers", h.ListBrokers)
	r.Post("/api/brokers", h.CreateBroker)
	r.Get("/api/brokers/status", h.GetBrokersStatus)
	r.Put("/api/brokers/reorder", h.ReorderBrokers)
	r.Put("/api/brokers/{id}", h.UpdateBroker)
	r.Delete("/api/brokers/{id}", h.DeleteBroker)
	return r
}

func TestListBrokers_Empty(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/brokers", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var brokers []models.MQTTBroker
	decodeJSON(t, rec.Body, &brokers)
	if len(brokers) != 0 {
		t.Errorf("expected empty list, got %d", len(brokers))
	}
}

func TestListBrokers_WithEnabledBroker(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	reg.statuses["b1"] = "CONNECTED"
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, is_enabled, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, '', '', 1, 0)`)

	req := httptest.NewRequest(http.MethodGet, "/api/brokers", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var brokers []models.MQTTBroker
	decodeJSON(t, rec.Body, &brokers)
	if len(brokers) != 1 {
		t.Fatalf("expected 1 broker, got %d", len(brokers))
	}
	if brokers[0].Status != "CONNECTED" {
		t.Errorf("status = %q, want 'CONNECTED'", brokers[0].Status)
	}
}

func TestListBrokers_DisabledBroker(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, is_enabled, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, '', '', 0, 0)`)

	req := httptest.NewRequest(http.MethodGet, "/api/brokers", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var brokers []models.MQTTBroker
	decodeJSON(t, rec.Body, &brokers)
	if len(brokers) != 1 {
		t.Fatalf("expected 1 broker, got %d", len(brokers))
	}
	if brokers[0].Status != "DISABLED" {
		t.Errorf("status = %q, want 'DISABLED'", brokers[0].Status)
	}
}

func TestCreateBroker_Success(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	body := jsonBody(t, map[string]any{
		"name":       "Test",
		"host":       "localhost",
		"port":       "1883",
		"is_enabled": true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/brokers", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var b models.MQTTBroker
	decodeJSON(t, rec.Body, &b)
	if b.Name != "Test" {
		t.Errorf("name = %q, want 'Test'", b.Name)
	}
	if b.ID == "" {
		t.Error("expected non-empty ID")
	}
}

func TestCreateBroker_Disabled(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	body := jsonBody(t, map[string]any{
		"name":       "Disabled",
		"host":       "localhost",
		"port":       "1883",
		"is_enabled": false,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/brokers", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	var b models.MQTTBroker
	decodeJSON(t, rec.Body, &b)
	if b.Status != "DISABLED" {
		t.Errorf("status = %q, want 'DISABLED'", b.Status)
	}
}

func TestCreateBroker_ConnectError(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	reg.addBrokerErr = errTest
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	body := jsonBody(t, map[string]any{
		"name":       "Bad",
		"host":       "badhost",
		"port":       "1883",
		"is_enabled": true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/brokers", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (broker saved even if connect fails)", rec.Code)
	}
	var b models.MQTTBroker
	decodeJSON(t, rec.Body, &b)
	if b.Status != "ERROR" {
		t.Errorf("status = %q, want 'ERROR'", b.Status)
	}
}

func TestCreateBroker_MissingName(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	body := jsonBody(t, map[string]any{"host": "localhost", "port": "1883"})
	req := httptest.NewRequest(http.MethodPost, "/api/brokers", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestCreateBroker_MissingHost(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	body := jsonBody(t, map[string]any{"name": "x", "port": "1883"})
	req := httptest.NewRequest(http.MethodPost, "/api/brokers", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestCreateBroker_InvalidPort(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	body := jsonBody(t, map[string]any{"name": "x", "host": "localhost", "port": "99999"})
	req := httptest.NewRequest(http.MethodPost, "/api/brokers", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestDeleteBroker_Success(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, 0)`)

	req := httptest.NewRequest(http.MethodDelete, "/api/brokers/b1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}

	var count int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE id='b1'`).Scan(&count)
	if count != 0 {
		t.Error("broker still in DB after delete")
	}
}

func TestDeleteBroker_NotFound(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/api/brokers/missing", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestGetBrokersStatus(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, 1, 0)`)
	reg.statuses["b1"] = "CONNECTED"

	req := httptest.NewRequest(http.MethodGet, "/api/brokers/status", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var result []map[string]any
	decodeJSON(t, rec.Body, &result)
	if len(result) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(result))
	}
	if result[0]["status"] != "CONNECTED" {
		t.Errorf("status = %v, want CONNECTED", result[0]["status"])
	}
}

func TestGetBrokersStatus_Disabled(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, is_enabled, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, 0, 0)`)

	req := httptest.NewRequest(http.MethodGet, "/api/brokers/status", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var result []map[string]any
	decodeJSON(t, rec.Body, &result)
	if len(result) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(result))
	}
	if result[0]["status"] != "DISABLED" {
		t.Errorf("status = %v, want DISABLED", result[0]["status"])
	}
}

func TestUpdateBroker_Disable(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, password, is_enabled, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, '', '', '', 1, 0)`)
	reg.statuses["b1"] = "CONNECTED"

	disabled := false
	body := jsonBody(t, map[string]any{"is_enabled": &disabled})
	req := httptest.NewRequest(http.MethodPut, "/api/brokers/b1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var b models.MQTTBroker
	decodeJSON(t, rec.Body, &b)
	if b.Status != "DISABLED" {
		t.Errorf("status = %q, want 'DISABLED'", b.Status)
	}
}

func TestUpdateBroker_Enable(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, password, is_enabled, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, '', '', '', 0, 0)`)

	enabled := true
	body := jsonBody(t, map[string]any{"is_enabled": &enabled})
	req := httptest.NewRequest(http.MethodPut, "/api/brokers/b1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var b models.MQTTBroker
	decodeJSON(t, rec.Body, &b)
	if b.IsEnabled != true {
		t.Error("broker should be enabled after update")
	}
}

func TestUpdateBroker_Reconfigure(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	reg.statuses["b1"] = "CONNECTED"
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, password, is_enabled, sort_order) VALUES ('b1', 'Test', 'localhost', 1883, '', '', '', 1, 0)`)

	newHost := "newhost"
	body := jsonBody(t, map[string]any{"host": &newHost})
	req := httptest.NewRequest(http.MethodPut, "/api/brokers/b1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var b models.MQTTBroker
	decodeJSON(t, rec.Body, &b)
	if b.Host != "newhost" {
		t.Errorf("host = %q, want 'newhost'", b.Host)
	}
}

func TestUpdateBroker_NotFound(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	body := jsonBody(t, map[string]any{"name": "new"})
	req := httptest.NewRequest(http.MethodPut, "/api/brokers/missing", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestReorderBrokers(t *testing.T) {
	database := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(database, reg)
	r := newBrokerRouter(h)

	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, sort_order) VALUES ('b1', 'A', 'localhost', 1883, 0)`)
	database.Exec(`INSERT INTO mqtt_brokers (id, name, host, port, sort_order) VALUES ('b2', 'B', 'localhost', 1884, 1)`)

	body := jsonBody(t, map[string]any{
		"brokers": []map[string]any{
			{"id": "b1", "sort_order": 5},
			{"id": "b2", "sort_order": 3},
		},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/brokers/reorder", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}

	var ord int
	database.QueryRow(`SELECT sort_order FROM mqtt_brokers WHERE id='b1'`).Scan(&ord)
	if ord != 5 {
		t.Errorf("b1 sort_order = %d, want 5", ord)
	}
}

func TestReorderBrokers_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/brokers/reorder", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpdateBroker_InvalidJSON(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	h := handlers.NewBrokerHandler(db, reg)
	r := newBrokerRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/api/brokers/b1", strings.NewReader("{bad}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
