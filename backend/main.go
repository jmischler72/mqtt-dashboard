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
	"mqtt-dashboard/handlers"
	"mqtt-dashboard/logic"
	"mqtt-dashboard/models"
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

	// --- Init Logic engine ---
	logicEngine := logic.NewEngine(registry)
	defer logicEngine.Stop()
	loadLogicRulesFromDB(database, logicEngine)

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
	app.Get("/api/logic/{panelId}/status", logicH.GetLogicStatus)

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

// loadLogicRulesFromDB reloads all logic panel rules from the database on startup.
func loadLogicRulesFromDB(database *sql.DB, engine logic.LogicEngine) {
	rows, err := database.Query(`SELECT id, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE panel_type = 'logic'`)
	if err != nil {
		slog.Error("load logic rules", "err", err)
		return
	}
	type rawLogicRow struct {
		panelID  string
		cfgJSON  string
		brokerID string
	}
	var loaded []rawLogicRow
	for rows.Next() {
		var r rawLogicRow
		if err := rows.Scan(&r.panelID, &r.cfgJSON, &r.brokerID); err == nil {
			loaded = append(loaded, r)
		}
	}
	_ = rows.Close()

	for _, item := range loaded {
		var rule logic.Rule
		if err := json.Unmarshal([]byte(item.cfgJSON), &rule); err != nil || rule.SourceTopic == "" || rule.TargetTopic == "" {
			continue
		}
		rule.PanelID = item.panelID
		if rule.BrokerID == "" {
			rule.BrokerID = item.brokerID
		}
		// Prime cache from history for source topic and all condition topics
		top := rule.SourceTopic
		if top == "" && len(rule.Conditions) > 0 {
			top = rule.Conditions[0].Topic
		}
		if top != "" {
			var payload string
			if err := database.QueryRow(`SELECT payload FROM mqtt_history WHERE broker_id = ? AND topic = ? ORDER BY timestamp DESC LIMIT 1`, rule.BrokerID, top).Scan(&payload); err == nil {
				engine.PrimeCache(rule.BrokerID, top, payload)
			}
		}
		for _, c := range rule.Conditions {
			cB := c.BrokerID
			if cB == "" {
				cB = rule.BrokerID
			}
			cT := c.Topic
			if cT != "" {
				var payload string
				if err := database.QueryRow(`SELECT payload FROM mqtt_history WHERE broker_id = ? AND topic = ? ORDER BY timestamp DESC LIMIT 1`, cB, cT).Scan(&payload); err == nil {
					engine.PrimeCache(cB, cT, payload)
				}
			}
		}
		if err := engine.AddRule(&rule); err != nil {
			slog.Error("load logic rule", "panel_id", item.panelID, "err", err)
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
