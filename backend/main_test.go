package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
	mqttclient "mqtt-dashboard/mqtt"
	"mqtt-dashboard/ws"
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
	var passedPath string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		passedPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	})

	// Use an empty in-memory FS so all paths fall through to the inner handler with path "/".
	emptyFS := fstest.MapFS{}
	h := spaHandler(emptyFS, inner)
	req := httptest.NewRequest(http.MethodGet, "/some/path", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Error("spaHandler should delegate to inner file server")
	}
	if passedPath != "/" {
		t.Errorf("spaHandler fallback path = %q, want '/'", passedPath)
	}
}

func TestSpaHandler_ServesExistingFile(t *testing.T) {
	var passedPath string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		passedPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	})

	testFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html></html>")},
		"app.js":     &fstest.MapFile{Data: []byte("console.log('hi')")},
	}

	h := spaHandler(testFS, inner)

	// Test existing app.js
	req := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if passedPath != "/app.js" {
		t.Errorf("spaHandler existing file path = %q, want '/app.js'", passedPath)
	}

	// Test root path "" which maps to index.html
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if passedPath != "/" {
		t.Errorf("spaHandler root path = %q, want '/'", passedPath)
	}
}

func TestInitRegistrySettings(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)

	// Default setting is save_sys_topics = 0 (false)
	initRegistrySettings(database, registry)

	// Update to 1 (true)
	if _, err := database.Exec(`UPDATE app_settings SET save_sys_topics = 1 WHERE id = 1`); err != nil {
		t.Fatalf("update app_settings: %v", err)
	}
	initRegistrySettings(database, registry)

	// Test with closed db (error fallback)
	dbClosed, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	dbClosed.Close()
	initRegistrySettings(dbClosed, registry)
}

func TestAutoConnectFromDB(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)

	// Insert enabled and disabled brokers (use invalid ca_cert so TLS parsing fails immediately without network timeout)
	_, err = database.Exec(`
		INSERT INTO mqtt_brokers (id, name, host, port, client_id, is_enabled, sort_order, tls_enabled, ca_cert)
		VALUES 
			('b1', 'Broker 1', 'localhost', 1883, 'c1', 1, 1, 1, 'invalid-ca'),
			('b2', 'Broker 2', '127.0.0.1', 1884, 'c2', 1, 2, 1, 'invalid-ca'),
			('b3', 'Broker 3', 'localhost', 1885, 'c3', 0, 3, 0, '')
	`)
	if err != nil {
		t.Fatalf("insert brokers: %v", err)
	}

	autoConnectFromDB(database, registry)

	if registry.DefaultBrokerID() != "b1" {
		t.Errorf("DefaultBrokerID = %q, want 'b1'", registry.DefaultBrokerID())
	}

	// Test with closed DB
	dbClosed, _ := db.InitDB(":memory:")
	dbClosed.Close()
	autoConnectFromDB(dbClosed, registry)
}

func TestLoadCronJobsFromDB(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)
	scheduler, err := cron.NewScheduler(registry)
	if err != nil {
		t.Fatalf("NewScheduler: %v", err)
	}

	// Insert various layouts: valid cron, invalid json, empty cron_expr, non-cron panel
	_, err = database.Exec(`
		INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, config_json, broker_id)
		VALUES 
			('p1', 'default', 'Cron 1', 'cron', '{"cron_expr":"*/5 * * * *","topic":"test","payload":"hi","qos":0,"retain":false,"enabled":true}', 'b1'),
			('p2', 'default', 'Cron Bad JSON', 'cron', 'invalid json', 'b1'),
			('p3', 'default', 'Cron Empty Expr', 'cron', '{"cron_expr":""}', 'b1'),
			('p4', 'default', 'Button Panel', 'button', '{}', 'b1')
	`)
	if err != nil {
		t.Fatalf("insert layouts: %v", err)
	}

	loadCronJobsFromDB(database, scheduler)

	if _, ok := scheduler.GetJob("p1"); !ok {
		t.Error("expected job p1 to be loaded")
	}
	if _, ok := scheduler.GetJob("p2"); ok {
		t.Error("expected job p2 not to be loaded")
	}

	// Test with closed DB
	dbClosed, _ := db.InitDB(":memory:")
	dbClosed.Close()
	loadCronJobsFromDB(dbClosed, scheduler)
}

func TestBuildRouter(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	registry := mqttclient.NewRegistry(database)
	scheduler, err := cron.NewScheduler(registry)
	if err != nil {
		t.Fatalf("NewScheduler: %v", err)
	}
	wsHub := ws.NewHub(registry)
	testFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>app</html>")},
	}

	router := buildRouter(database, registry, scheduler, wsHub, t.TempDir(), testFS)

	// Health check
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("health status = %d, want 200", rec.Code)
	}

	// Static fallback
	req = httptest.NewRequest(http.MethodGet, "/unknown-page", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("static fallback status = %d, want 200", rec.Code)
	}
}
