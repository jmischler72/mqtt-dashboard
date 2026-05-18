package handlers_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
)

func newPublishRouter(h *handlers.PublishHandler) chi.Router {
	r := chi.NewRouter()
	r.Post("/api/publish", h.Publish)
	return r
}

func TestPublish_Success(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	reg.defaultID = "broker1"
	h := handlers.NewPublishHandler(db, reg)
	r := newPublishRouter(h)

	body := jsonBody(t, map[string]string{
		"topic":   "test/topic",
		"payload": "hello",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/publish", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(reg.publishCalls) != 1 {
		t.Fatalf("expected 1 publish call, got %d", len(reg.publishCalls))
	}
	if reg.publishCalls[0].topic != "test/topic" {
		t.Errorf("published topic = %q, want 'test/topic'", reg.publishCalls[0].topic)
	}
}

func TestPublish_MissingTopic(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	reg.defaultID = "broker1"
	h := handlers.NewPublishHandler(db, reg)
	r := newPublishRouter(h)

	body := jsonBody(t, map[string]string{"payload": "hello"})
	req := httptest.NewRequest(http.MethodPost, "/api/publish", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPublish_NoBroker(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	// no defaultID set
	h := handlers.NewPublishHandler(db, reg)
	r := newPublishRouter(h)

	body := jsonBody(t, map[string]string{"topic": "test/topic", "payload": "hello"})
	req := httptest.NewRequest(http.MethodPost, "/api/publish", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestPublish_PublishError(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	reg.defaultID = "broker1"
	reg.publishErr = errors.New("connection lost")
	h := handlers.NewPublishHandler(db, reg)
	r := newPublishRouter(h)

	body := jsonBody(t, map[string]string{"topic": "test/topic", "payload": "hello"})
	req := httptest.NewRequest(http.MethodPost, "/api/publish", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestPublish_UsesBrokerIDFromRequest(t *testing.T) {
	db := setupTestDB(t)
	reg := newMockRegistry()
	reg.defaultID = "default-broker"
	h := handlers.NewPublishHandler(db, reg)
	r := newPublishRouter(h)

	body := jsonBody(t, map[string]string{
		"broker_id": "specific-broker",
		"topic":     "test/topic",
		"payload":   "data",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/publish", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if reg.publishCalls[0].brokerID != "specific-broker" {
		t.Errorf("brokerID = %q, want 'specific-broker'", reg.publishCalls[0].brokerID)
	}
}
