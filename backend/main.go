package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"mqtt-dashboard/config"
	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
	"mqtt-dashboard/handlers"
	"mqtt-dashboard/models"
	"mqtt-dashboard/ws"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	mqttclient "mqtt-dashboard/mqtt"
)

//go:embed dist/*
var embeddedFiles embed.FS

func main() {
	runtimeConfig, err := config.LoadRuntimeConfig()
	if err != nil {
		slog.Error("load runtime config", "err", err)
		os.Exit(1)
	}

	// --- Configure slog ---
	logLevel := new(slog.LevelVar)
	logLevel.Set(slog.LevelInfo)
	if lvl := runtimeConfig.LogLevel; lvl != "" {
		if err := logLevel.UnmarshalText([]byte(lvl)); err != nil {
			slog.Warn("invalid LOG_LEVEL, defaulting to info", "value", lvl)
		}
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})))

	// --- Init database ---
	if err := os.MkdirAll(runtimeConfig.DataDir, 0o750); err != nil {
		slog.Error("create data dir", "err", err)
		os.Exit(1)
	}
	database, err := db.InitDB(filepath.Join(runtimeConfig.DataDir, "mqtt-dashboard.db"))
	if err != nil {
		slog.Error("init db", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	// --- Seed Brokers from Config File (if configured) ---
	config.SeedBrokersFromPath(database, runtimeConfig.SeedConfigFile)

	// --- Init broker registry ---
	registry := mqttclient.NewRegistry(database)
	registry.StartHistoryWriter()
	defer registry.StopHistoryWriter()
	initRegistrySettings(database, registry)
	autoConnectFromDB(database, registry)

	// --- Init Cron scheduler ---
	scheduler, err := cron.NewScheduler(registry)
	if err != nil {
		slog.Error("init scheduler", "err", err)
		os.Exit(1)
	}
	scheduler.Start()
	defer scheduler.Stop()
	loadCronJobsFromDB(database, scheduler)
	if err := scheduler.StartPruningJob(database); err != nil {
		slog.Error("start pruning job", "err", err)
	}

	// --- Init WebSocket hub ---
	wsHub := ws.NewHub(registry, database)

	var frontendFS fs.FS
	if os.Getenv("APP_ENV") != "development" {
		var err error
		frontendFS, err = fs.Sub(embeddedFiles, "dist")
		if err != nil {
			slog.Error("embed dist", "err", err)
			os.Exit(1)
		}
	}

	r := buildRouter(database, registry, scheduler, wsHub, runtimeConfig.DataDir, frontendFS, runtimeConfig.BasePath)

	slog.Info("server starting", "addr", runtimeConfig.HTTPAddr, "base_path", runtimeConfig.BasePath, "data_dir", runtimeConfig.DataDir)
	if err := http.ListenAndServe(runtimeConfig.HTTPAddr, r); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

func buildRouter(database *sql.DB, registry *mqttclient.BrokerRegistry, scheduler *cron.Scheduler, wsHub *ws.Hub, dataDir string, frontendFS fs.FS, basePath string) http.Handler {
	// --- Init handlers ---
	brokerH := handlers.NewBrokerHandler(database, registry)
	layoutH := handlers.NewLayoutHandler(database, scheduler)
	layoutH.SetInvalidator(wsHub)
	publishH := handlers.NewPublishHandler(database, registry)
	cronH := handlers.NewCronHandler(database, scheduler)
	dashboardH := handlers.NewDashboardHandler(database, scheduler)
	dashboardH.SetInvalidator(wsHub)
	settingsH := handlers.NewSettingsHandler(database, registry)
	explorerH := handlers.NewExplorerHandler(database)
	imageH := handlers.NewImageHandler(dataDir)

	// --- Router ---
	app := chi.NewRouter()
	statusEndpoint := strings.TrimSuffix(basePath, "/") + "/api/brokers/status"
	app.Use(skipLoggerForPaths(middleware.Logger, statusEndpoint))
	app.Use(middleware.Recoverer)
	app.Use(corsMiddleware)

	// Health
	app.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Brokers
	app.Get("/api/brokers", brokerH.ListBrokers)
	app.Post("/api/brokers", brokerH.CreateBroker)
	app.Get("/api/brokers/status", brokerH.GetBrokersStatus)
	app.Put("/api/brokers/reorder", brokerH.ReorderBrokers)
	app.Get("/api/brokers/{id}/info", brokerH.GetBrokerInfo)
	app.Put("/api/brokers/{id}", brokerH.UpdateBroker)
	app.Delete("/api/brokers/{id}", brokerH.DeleteBroker)

	// Layouts
	app.Get("/api/layouts", layoutH.GetLayouts)
	app.Post("/api/layouts", layoutH.CreatePanel)
	app.Put("/api/layouts/batch", layoutH.BatchUpdatePositions)
	app.Put("/api/layouts/{id}", layoutH.UpdatePanel)
	app.Delete("/api/layouts/{id}", layoutH.DeletePanel)

	// Dashboards
	app.Get("/api/dashboards", dashboardH.ListDashboards)
	app.Post("/api/dashboards", dashboardH.CreateDashboard)
	app.Post("/api/dashboards/import", dashboardH.ImportDashboard)
	app.Put("/api/dashboards/{id}", dashboardH.RenameDashboard)
	app.Delete("/api/dashboards/{id}", dashboardH.DeleteDashboard)

	// Publish
	app.Post("/api/publish", publishH.Publish)

	// Cron
	app.Get("/api/cron", cronH.ListCronJobs)
	app.Post("/api/cron/{panelId}", cronH.UpsertCron)
	app.Delete("/api/cron/{panelId}", cronH.DeleteCron)
	app.Put("/api/cron/{panelId}/toggle", cronH.ToggleCron)
	app.Get("/api/cron/{panelId}", cronH.GetCronStatus)

	// Settings
	app.Get("/api/settings", settingsH.GetSettings)
	app.Put("/api/settings", settingsH.UpdateSettings)
	app.Patch("/api/settings", settingsH.PatchSettings)

	// History
	app.Get("/api/history/size", settingsH.GetHistorySize)
	app.Delete("/api/history", settingsH.ClearHistory)

	// Images (visual panels)
	app.Post("/api/images", imageH.UploadImage)
	app.Get("/api/images/presets", imageH.ListPresets)
	app.Get("/api/images/{filename}", imageH.ServeImage)
	app.Delete("/api/images/{filename}", imageH.DeleteImage)

	// Explorer
	app.Get("/api/explorer/tree", explorerH.GetTree)
	app.Get("/api/explorer/history", explorerH.GetHistory)
	app.Get("/api/explorer/activity", explorerH.GetActivity)

	// WebSocket
	app.Get("/ws", wsHub.ServeWS)

	// Static frontend (production only)
	if frontendFS != nil {
		app.Handle("/*", spaHandler(frontendFS, http.FileServer(http.FS(frontendFS)), basePath))
	}

	if basePath == "/" {
		return app
	}
	r := chi.NewRouter()
	r.Mount(strings.TrimSuffix(basePath, "/"), app)
	return r
}

// initRegistrySettings reads app_settings from the DB and applies them to the registry.
func initRegistrySettings(database *sql.DB, registry *mqttclient.BrokerRegistry) {
	var saveSys bool
	row := database.QueryRow(`SELECT COALESCE(save_sys_topics, 0) FROM app_settings WHERE id = 1`)
	if err := row.Scan(&saveSys); err != nil {
		saveSys = false
	}
	registry.SetSaveSysTopics(saveSys)
}

// autoConnectFromDB loads all enabled brokers and connects each one on startup.
func autoConnectFromDB(database *sql.DB, registry *mqttclient.BrokerRegistry) {
	rows, err := database.Query(`SELECT id, name, host, port, COALESCE(client_id,''), COALESCE(username,''), COALESCE(password,''), is_enabled, sort_order, COALESCE(auth_mode,'none'), tls_enabled, tls_skip_verify, COALESCE(ca_cert,''), COALESCE(client_cert,''), COALESCE(client_key,'') FROM mqtt_brokers WHERE is_enabled = 1 ORDER BY sort_order ASC`)
	if err != nil {
		return
	}
	defer rows.Close()

	isFirst := true
	for rows.Next() {
		var b models.MQTTBroker
		if err := rows.Scan(&b.ID, &b.Name, &b.Host, &b.Port, &b.ClientID, &b.Username, &b.Password, &b.IsEnabled, &b.SortOrder, &b.AuthMode, &b.TLSEnabled, &b.TLSSkipVerify, &b.CACert, &b.ClientCert, &b.ClientKey); err != nil {
			continue
		}
		if err := registry.AddBroker(b); err != nil {
			slog.Error("auto-connect mqtt broker", "broker", b.Name, "err", err)
		}
		if isFirst {
			registry.SetDefault(b.ID)
			isFirst = false
		}
	}
}

// loadCronJobsFromDB reloads all cron panel jobs from the database on startup.
func loadCronJobsFromDB(database *sql.DB, scheduler *cron.Scheduler) {
	rows, err := database.Query(`SELECT id, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE panel_type = 'cron'`)
	if err != nil {
		slog.Error("load cron jobs", "err", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var panelID, cfgJSON, brokerID string
		if err := rows.Scan(&panelID, &cfgJSON, &brokerID); err != nil {
			continue
		}
		var cfg struct {
			BrokerID string `json:"broker_id"`
			CronExpr string `json:"cron_expr"`
			Topic    string `json:"topic"`
			Payload  string `json:"payload"`
			QoS      int    `json:"qos"`
			Retain   bool   `json:"retain"`
			Enabled  bool   `json:"enabled"`
		}
		if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil || cfg.CronExpr == "" {
			continue
		}
		bID := cfg.BrokerID
		if bID == "" {
			bID = brokerID
		}
		if err := scheduler.AddJob(panelID, bID, cfg.CronExpr, cfg.Topic, cfg.Payload, byte(cfg.QoS), cfg.Retain, cfg.Enabled); err != nil {
			slog.Error("load cron job", "panel_id", panelID, "err", err)
		}
	}
}

// spaHandler wraps a file server to serve index.html for unknown paths (client-side routing).
func spaHandler(distFS fs.FS, h http.Handler, basePath string) http.Handler {
	indexHTML, indexErr := precomputeIndexHTML(distFS, basePath)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		requestPath := r.URL.Path
		if basePath != "/" {
			requestPath = strings.TrimPrefix(requestPath, strings.TrimSuffix(basePath, "/"))
		}
		trimmed := strings.TrimPrefix(requestPath, "/")
		if trimmed == "api" || strings.HasPrefix(trimmed, "api/") {
			http.NotFound(w, r)
			return
		}
		path := trimmed
		if path == "" {
			path = "index.html"
		}
		stat, err := fs.Stat(distFS, path)
		if err != nil || stat.IsDir() || path == "index.html" {
			serveIndex(w, indexHTML, indexErr)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + path
		h.ServeHTTP(w, r2)
	})
}

// precomputeIndexHTML reads and injects the document base into index.html once at startup.
func precomputeIndexHTML(distFS fs.FS, basePath string) ([]byte, error) {
	data, err := fs.ReadFile(distFS, "index.html")
	if err != nil {
		return nil, errors.New("frontend index not found")
	}
	const marker = "</head>"
	if !strings.Contains(string(data), marker) {
		return nil, errors.New("frontend index is invalid")
	}
	base := `<base href="` + basePath + `">`
	return []byte(strings.Replace(string(data), marker, base+marker, 1)), nil
}

// serveIndex writes the precomputed index.html. The production frontend
// is built with relative asset URLs, so one embedded binary can be mounted at
// either / or a validated sub-path without a separate frontend build.
func serveIndex(w http.ResponseWriter, indexHTML []byte, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(indexHTML)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// skipLoggerForPaths wraps a middleware logger to skip logging requests matching specific path prefixes
func skipLoggerForPaths(logger func(http.Handler) http.Handler, skipPrefixes ...string) func(http.Handler) http.Handler {
	skip := make(map[string]struct{}, len(skipPrefixes))
	for _, p := range skipPrefixes {
		skip[p] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		logged := logger(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := skip[r.URL.Path]; ok {
				next.ServeHTTP(w, r)
				return
			}
			logged.ServeHTTP(w, r)
		})
	}
}
