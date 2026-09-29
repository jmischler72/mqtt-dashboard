package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
	"mqtt-dashboard/logic"
)

func TestLogicHandler_UpsertLogic(t *testing.T) {
	database := setupTestDB(t)
	defer database.Close()

	engine := newMockLogicEngine()
	h := handlers.NewLogicHandler(database, engine)

	// Seed panel
	_, err := database.Exec(`
		INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, config_json, broker_id)
		VALUES ('p_log1', 'default', 'Logic Panel', 'logic', '{}', 'b1')
	`)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	r := chi.NewRouter()
	r.Post("/api/logic/{panelId}", h.UpsertLogic)

	body := []byte(`{
		"source_topic": "sensors/temp",
		"target_topic": "fans/set",
		"mode": "every",
		"payload": "ON",
		"enabled": true
	}`)

	req := httptest.NewRequest(http.MethodPost, "/api/logic/p_log1", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	if engine.addCalls != 1 {
		t.Errorf("expected 1 add call, got %d", engine.addCalls)
	}

	// Verify DB config_json was updated
	var cfgStr string
	err = database.QueryRow(`SELECT config_json FROM dashboard_layouts WHERE id = 'p_log1'`).Scan(&cfgStr)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	var cfg map[string]any
	json.Unmarshal([]byte(cfgStr), &cfg)
	if cfg["source_topic"] != "sensors/temp" || cfg["target_topic"] != "fans/set" {
		t.Errorf("unexpected config_json: %s", cfgStr)
	}
}

func TestLogicHandler_UpsertLogic_InvalidBody_And_Error(t *testing.T) {
	database := setupTestDB(t)
	defer database.Close()

	engine := newMockLogicEngine()
	h := handlers.NewLogicHandler(database, engine)

	r := chi.NewRouter()
	r.Post("/api/logic/{panelId}", h.UpsertLogic)

	// Bad JSON
	req := httptest.NewRequest(http.MethodPost, "/api/logic/p1", bytes.NewReader([]byte("not json")))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for bad json, got %d", w.Code)
	}

	// Engine error
	engine.addErr = errors.New("cannot match loop")
	req2 := httptest.NewRequest(http.MethodPost, "/api/logic/p1", bytes.NewReader([]byte(`{"source_topic":"a","target_topic":"a"}`)))
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 on engine error, got %d", w2.Code)
	}
}

func TestLogicHandler_DeleteLogic(t *testing.T) {
	engine := newMockLogicEngine()
	h := handlers.NewLogicHandler(nil, engine)

	r := chi.NewRouter()
	r.Delete("/api/logic/{panelId}", h.DeleteLogic)

	req := httptest.NewRequest(http.MethodDelete, "/api/logic/p_del", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}

	if len(engine.removeCalls) != 1 || engine.removeCalls[0] != "p_del" {
		t.Errorf("expected RemoveRule call for 'p_del', got %v", engine.removeCalls)
	}
}

func TestLogicHandler_ToggleLogic(t *testing.T) {
	database := setupTestDB(t)
	defer database.Close()

	engine := newMockLogicEngine()
	h := handlers.NewLogicHandler(database, engine)

	_, _ = database.Exec(`
		INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, config_json, broker_id)
		VALUES ('p_tog', 'default', 'Logic', 'logic', '{"source_topic":"in","target_topic":"out","enabled":false}', 'b1')
	`)

	r := chi.NewRouter()
	r.Put("/api/logic/{panelId}/toggle", h.ToggleLogic)

	// Lazy recovery when not in engine yet
	body := []byte(`{"enabled": true}`)
	req := httptest.NewRequest(http.MethodPut, "/api/logic/p_tog/toggle", bytes.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on toggle with lazy recovery, got %d: %s", w.Code, w.Body.String())
	}

	// Toggle existing in engine
	body2 := []byte(`{"enabled": false}`)
	req2 := httptest.NewRequest(http.MethodPut, "/api/logic/p_tog/toggle", bytes.NewReader(body2))
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 on toggle, got %d: %s", w2.Code, w2.Body.String())
	}

	// Toggle non-existent
	req3 := httptest.NewRequest(http.MethodPut, "/api/logic/non_existent/toggle", bytes.NewReader(body2))
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusNotFound {
		t.Errorf("expected 404 on non-existent, got %d", w3.Code)
	}
}

func TestLogicHandler_GetLogicStatus(t *testing.T) {
	database := setupTestDB(t)
	defer database.Close()

	engine := newMockLogicEngine()
	h := handlers.NewLogicHandler(database, engine)

	_, _ = database.Exec(`
		INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, config_json, broker_id)
		VALUES ('p_stat', 'default', 'Logic', 'logic', '{"source_topic":"in","target_topic":"out","enabled":true}', 'b1')
	`)

	r := chi.NewRouter()
	r.Get("/api/logic/{panelId}", h.GetLogicStatus)

	// Status with lazy recovery from DB
	req := httptest.NewRequest(http.MethodGet, "/api/logic/p_stat", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var status logic.RuleStatus
	if err := json.NewDecoder(w.Body).Decode(&status); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if status.PanelID != "p_stat" || !status.Enabled {
		t.Errorf("unexpected status: %+v", status)
	}

	// Non-existent status -> 404
	req2 := httptest.NewRequest(http.MethodGet, "/api/logic/unknown", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unknown panel, got %d", w2.Code)
	}
}

// Silence unused context import
var _ = context.Background
