package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
)

func newExplorerRouter(h *handlers.ExplorerHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/explorer/tree", h.GetTree)
	r.Get("/api/explorer/history", h.GetHistory)
	return r
}

func TestGetTree_MissingBrokerID(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewExplorerHandler(db)
	r := newExplorerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/tree", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetTree_Empty(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewExplorerHandler(db)
	r := newExplorerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/tree?broker_id=broker1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var topics []string
	decodeJSON(t, rec.Body, &topics)
	if len(topics) != 0 {
		t.Errorf("expected empty topics, got %v", topics)
	}
}

func TestGetTree_WithHistory(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/humidity', '60')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '26')`) // duplicate

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/tree?broker_id=b1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var topics []string
	decodeJSON(t, rec.Body, &topics)
	if len(topics) != 2 {
		t.Errorf("expected 2 distinct topics, got %d: %v", len(topics), topics)
	}
}

func TestGetHistory_MissingParams(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewExplorerHandler(db)
	r := newExplorerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetHistory_WithRecords(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '30')`)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=sensor/temp", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 2 {
		t.Errorf("expected 2 records, got %d", len(records))
	}
}

func TestGetHistory_FiltersByBroker(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'a/b', 'x')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b2', 'a/b', 'y')`)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=a/b", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 1 {
		t.Errorf("expected 1 record for b1, got %d", len(records))
	}
}
