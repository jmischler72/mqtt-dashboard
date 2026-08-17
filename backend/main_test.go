package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"testing/fstest"

	"mqtt-dashboard/db"
)



func TestCorsMiddleware_SetsHeaders(t *testing.T) {
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want '*'", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("Access-Control-Allow-Methods should be set")
	}
}

func TestCorsMiddleware_PreflightReturns204(t *testing.T) {
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called for OPTIONS preflight")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/brokers", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("OPTIONS status = %d, want 204", rec.Code)
	}
}

func TestSkipLoggerForPaths_SkipsMatchingPath(t *testing.T) {
	loggerCalled := false
	mockLogger := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			loggerCalled = true
			next.ServeHTTP(w, r)
		})
	}

	mw := skipLoggerForPaths(mockLogger, "/api/brokers/status")
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/brokers/status", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if loggerCalled {
		t.Error("logger should not be called for skipped path")
	}
}

func TestSkipLoggerForPaths_LogsNonSkippedPath(t *testing.T) {
	loggerCalled := false
	mockLogger := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			loggerCalled = true
			next.ServeHTTP(w, r)
		})
	}

	mw := skipLoggerForPaths(mockLogger, "/api/brokers/status")
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/brokers", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !loggerCalled {
		t.Error("logger should be called for non-skipped path")
	}
}

func TestSpaHandler_DelegatesToFileServer(t *testing.T) {
	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	// Use an empty in-memory FS so all paths fall through to the inner handler.
	emptyFS := fstest.MapFS{}
	h := spaHandler(emptyFS, inner)
	req := httptest.NewRequest(http.MethodGet, "/some/path", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Error("spaHandler should delegate to inner file server")
	}
}

func TestSeedBrokersFromConfig(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}
	defer database.Close()

	tmpDir := t.TempDir()
	cfgPath := tmpDir + "/config.json"
	os.WriteFile(cfgPath, []byte(`{"brokers":[{"name":"Test Config Broker","host":"localhost","port":1883,"is_enabled":true}]}`), 0600)

	t.Setenv("CONFIG_FILE", cfgPath)
	seedBrokersFromConfig(database)

	var count int
	row := database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE name = 'Test Config Broker'`)
	if err := row.Scan(&count); err != nil || count != 1 {
		t.Fatalf("Expected 1 seeded broker from config file, got count %d (err: %v)", count, err)
	}

	// Verify non-destructive behavior (does NOT duplicate or delete existing brokers)
	seedBrokersFromConfig(database)
	var countAfterReSeed int
	database.QueryRow(`SELECT COUNT(*) FROM mqtt_brokers WHERE name = 'Test Config Broker'`).Scan(&countAfterReSeed)
	if countAfterReSeed != 1 {
		t.Errorf("Re-seeding should not duplicate or delete existing broker, got count %d", countAfterReSeed)
	}
}



