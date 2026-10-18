package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"mqtt-dashboard/config"
	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
	"mqtt-dashboard/demo"
	"mqtt-dashboard/handlers"
	"mqtt-dashboard/logic"
	"mqtt-dashboard/ws"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	mqttclient "mqtt-dashboard/mqtt"
)

//go:embed dist/*
var embeddedFiles embed.FS

var version = "dev"

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
	mqttclient.AutoConnectFromDB(database, registry)

	// --- Init Cron scheduler ---
	scheduler, err := cron.NewScheduler(registry)
	if err != nil {
		slog.Error("init scheduler", "err", err)
		os.Exit(1)
	}
	scheduler.Start()
	defer scheduler.Stop()
	cron.LoadJobsFromDB(database, scheduler)
	if err := scheduler.StartPruningJob(database); err != nil {
		slog.Error("start pruning job", "err", err)
	}

	// --- Init Logic engine ---
	logicEngine := logic.NewEngine(registry, logic.WithOnTrip(func(panelID string) {
		row := database.QueryRow(`SELECT COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, panelID)
		var cfgStr string
		if err := row.Scan(&cfgStr); err == nil {
			var cfgMap map[string]any
			if err := json.Unmarshal([]byte(cfgStr), &cfgMap); err == nil && cfgMap != nil {
				cfgMap["enabled"] = false
				if b, err := json.Marshal(cfgMap); err == nil {
					_, _ = database.Exec(`UPDATE dashboard_layouts SET config_json = ? WHERE id = ?`, string(b), panelID)
				}
			}
		}
	}))
	defer logicEngine.Stop()
	logic.LoadRulesFromDB(database, logicEngine)

	// --- Init WebSocket hub ---
	wsHub := ws.NewHub(registry, database)

	// --- Demo Mode Auto-Reset ---
	if runtimeConfig.DemoMode {
		cronExpr := os.Getenv("MQTT_DASHBOARD_DEMO_RESET_CRON")
		if err := demo.SetupAutoReset(database, registry, scheduler, logicEngine, wsHub, runtimeConfig.SeedConfigFile, cronExpr); err != nil {
			slog.Error("setup demo auto-reset", "err", err)
		}
	}

	var frontendFS fs.FS
	if os.Getenv("APP_ENV") != "development" {
		var err error
		frontendFS, err = fs.Sub(embeddedFiles, "dist")
		if err != nil {
			slog.Error("embed dist", "err", err)
			os.Exit(1)
		}
	}

	r := buildRouter(database, registry, scheduler, logicEngine, wsHub, runtimeConfig.DataDir, frontendFS, runtimeConfig.BasePath, runtimeConfig.DemoMode)

	serverURL := formatServerURL(runtimeConfig.HTTPAddr, runtimeConfig.BasePath)
	printBanner(os.Stderr, version, serverURL, runtimeConfig.DataDir, runtimeConfig.DemoMode)
	slog.Info("server starting", "version", version, "url", serverURL, "addr", runtimeConfig.HTTPAddr, "data_dir", runtimeConfig.DataDir, "demo_mode", runtimeConfig.DemoMode)
	if err := http.ListenAndServe(runtimeConfig.HTTPAddr, r); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

func printBanner(w io.Writer, version, serverURL, dataDir string, demoMode bool) {
	tag := ""
	if demoMode {
		tag = " (demo mode)"
	}
	fmt.Fprintf(w, "\n  MQTT Dashboard v-%s%s\n", version, tag)
	fmt.Fprintf(w, "  ➜  URL:   %s\n", serverURL)
	fmt.Fprintf(w, "  ➜  Storage: %s\n\n", dataDir)
}

func formatServerURL(addr, basePath string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		if strings.HasPrefix(addr, ":") {
			host = "localhost"
			port = strings.TrimPrefix(addr, ":")
		} else {
			host = "localhost"
			port = addr
		}
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	base := "/" + strings.Trim(basePath, "/")
	if base != "/" {
		base += "/"
	}
	if port == "80" {
		return fmt.Sprintf("http://%s%s", host, base)
	}
	return fmt.Sprintf("http://%s:%s%s", host, port, base)
}

func buildRouter(database *sql.DB, registry *mqttclient.BrokerRegistry, scheduler *cron.Scheduler, logicEngine logic.LogicEngine, wsHub *ws.Hub, dataDir string, frontendFS fs.FS, basePath string, demoMode ...bool) http.Handler {
	isDemo := len(demoMode) > 0 && demoMode[0]
	// --- Init handlers ---
	brokerH := handlers.NewBrokerHandler(database, registry)
	layoutH := handlers.NewLayoutHandler(database, scheduler)
	layoutH.SetInvalidator(wsHub)
	layoutH.SetLogicEngine(logicEngine)
	publishH := handlers.NewPublishHandler(database, registry)
	cronH := handlers.NewCronHandler(database, scheduler)
	logicH := handlers.NewLogicHandler(database, logicEngine)
	automationsH := handlers.NewAutomationsHandler(
		database,
		handlers.NewCronAutomationProvider(database, scheduler),
		handlers.NewLogicAutomationProvider(database, logicEngine),
	)
	dashboardH := handlers.NewDashboardHandler(database, scheduler)
	dashboardH.SetInvalidator(wsHub)
	dashboardH.SetLogicEngine(logicEngine)
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
		json.NewEncoder(w).Encode(map[string]any{
			"status":    "ok",
			"version":   version,
			"demo_mode": isDemo,
		})
	})

	// Runtime config
	app.Get("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"demo_mode": isDemo,
		})
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
	app.Post("/api/layouts/{id}/duplicate", layoutH.DuplicatePanel)
	app.Post("/api/layouts/{id}/move", layoutH.MovePanel)
	app.Post("/api/layouts/{id}/copy-to", layoutH.CopyPanelTo)
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

	// Automations (generalized)
	app.Get("/api/automations", automationsH.ListAutomations)
	app.Put("/api/automations/{panelId}/toggle", automationsH.ToggleAutomation)

	// Cron
	app.Post("/api/cron/{panelId}", cronH.UpsertCron)
	app.Delete("/api/cron/{panelId}", cronH.DeleteCron)
	app.Put("/api/cron/{panelId}/toggle", cronH.ToggleCron)
	app.Get("/api/cron/{panelId}", cronH.GetCronStatus)

	// Logic
	app.Post("/api/logic/{panelId}", logicH.UpsertLogic)
	app.Delete("/api/logic/{panelId}", logicH.DeleteLogic)
	app.Put("/api/logic/{panelId}/toggle", logicH.ToggleLogic)
	app.Get("/api/logic/{panelId}", logicH.GetLogicStatus)

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
		cleanPath := path.Clean("/" + requestPath)
		trimmed := strings.TrimPrefix(cleanPath, "/")
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

// skipLoggerForPaths wraps a middleware logger to skip logging requests matching specific exact paths
func skipLoggerForPaths(logger func(http.Handler) http.Handler, skipPaths ...string) func(http.Handler) http.Handler {
	skip := make(map[string]struct{}, len(skipPaths))
	for _, p := range skipPaths {
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
