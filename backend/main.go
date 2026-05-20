package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"io/fs"
	"log/slog"
	"strings"
	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
	"mqtt-dashboard/handlers"
	"mqtt-dashboard/models"
	"mqtt-dashboard/ws"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	mqttclient "mqtt-dashboard/mqtt"
)

//go:embed dist/*
var embeddedFiles embed.FS

func main() {
	// --- Configure slog ---
	logLevel := new(slog.LevelVar)
	logLevel.Set(slog.LevelInfo)
	if lvl := os.Getenv("LOG_LEVEL"); lvl != "" {
		if err := logLevel.UnmarshalText([]byte(lvl)); err != nil {
			slog.Warn("invalid LOG_LEVEL, defaulting to info", "value", lvl)
		}
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: logLevel})))

	// --- Init database ---
	if err := os.MkdirAll("./data", 0o750); err != nil {
		slog.Error("create data dir", "err", err)
		os.Exit(1)
	}
	database, err := db.InitDB("./data/mqtt-dashboard.db")
	if err != nil {
		slog.Error("init db", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	// --- Init broker registry ---
	registry := mqttclient.NewRegistry(database)
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
	wsHub := ws.NewHub(registry)

	// --- Init handlers ---
	brokerH := handlers.NewBrokerHandler(database, registry)
	layoutH := handlers.NewLayoutHandler(database)
	publishH := handlers.NewPublishHandler(database, registry)
	cronH := handlers.NewCronHandler(database, scheduler)
	dashboardH := handlers.NewDashboardHandler(database, scheduler)
	settingsH := handlers.NewSettingsHandler(database)
	explorerH := handlers.NewExplorerHandler(database)

	// --- Router ---
	r := chi.NewRouter()
	r.Use(skipLoggerForPaths(middleware.Logger, "/api/brokers/status"))
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// Health
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Brokers
	r.Get("/api/brokers", brokerH.ListBrokers)
	r.Post("/api/brokers", brokerH.CreateBroker)
	r.Get("/api/brokers/status", brokerH.GetBrokersStatus)
	r.Put("/api/brokers/reorder", brokerH.ReorderBrokers)
	r.Get("/api/brokers/{id}/info", brokerH.GetBrokerInfo)
	r.Put("/api/brokers/{id}", brokerH.UpdateBroker)
	r.Delete("/api/brokers/{id}", brokerH.DeleteBroker)

	// Layouts
	r.Get("/api/layouts", layoutH.GetLayouts)
	r.Post("/api/layouts", layoutH.CreatePanel)
	r.Put("/api/layouts/batch", layoutH.BatchUpdatePositions)
	r.Put("/api/layouts/{id}", layoutH.UpdatePanel)
	r.Delete("/api/layouts/{id}", layoutH.DeletePanel)

	// Dashboards
	r.Get("/api/dashboards", dashboardH.ListDashboards)
	r.Post("/api/dashboards", dashboardH.CreateDashboard)
	r.Put("/api/dashboards/{id}", dashboardH.RenameDashboard)
	r.Delete("/api/dashboards/{id}", dashboardH.DeleteDashboard)

	// Publish
	r.Post("/api/publish", publishH.Publish)

	// Cron
	r.Post("/api/cron/{panelId}", cronH.UpsertCron)
	r.Delete("/api/cron/{panelId}", cronH.DeleteCron)
	r.Put("/api/cron/{panelId}/toggle", cronH.ToggleCron)
	r.Get("/api/cron/{panelId}", cronH.GetCronStatus)

	// Settings
	r.Get("/api/settings", settingsH.GetSettings)
	r.Put("/api/settings", settingsH.UpdateSettings)
	r.Patch("/api/settings", settingsH.PatchSettings)

	// Explorer
	r.Get("/api/explorer/tree", explorerH.GetTree)
	r.Get("/api/explorer/history", explorerH.GetHistory)

	// WebSocket
	r.Get("/ws", wsHub.ServeWS)

	// Static frontend (production only)
	if os.Getenv("APP_ENV") != "development" {
		distFS, err := fs.Sub(embeddedFiles, "dist")
		if err != nil {
			slog.Error("embed dist", "err", err)
			os.Exit(1)
		}
		r.Handle("/*", spaHandler(distFS, http.FileServer(http.FS(distFS))))
	}

	addr := ":8080"
	slog.Info("server starting", "addr", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

// autoConnectFromDB loads all enabled brokers and connects each one on startup.
func autoConnectFromDB(database *sql.DB, registry *mqttclient.BrokerRegistry) {
	rows, err := database.Query(`SELECT id, name, host, port, client_id, username, password, is_enabled, sort_order FROM mqtt_brokers WHERE is_enabled = 1 ORDER BY sort_order ASC`)
	if err != nil {
		return
	}
	defer rows.Close()

	isFirst := true
	for rows.Next() {
		var b models.MQTTBroker
		if err := rows.Scan(&b.ID, &b.Name, &b.Host, &b.Port, &b.ClientID, &b.Username, &b.Password, &b.IsEnabled, &b.SortOrder); err != nil {
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
			CronExpr string `json:"cron_expr"`
			Topic    string `json:"topic"`
			Payload  string `json:"payload"`
			Enabled  bool   `json:"enabled"`
		}
		if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil || cfg.CronExpr == "" {
			continue
		}
		if err := scheduler.AddJob(panelID, brokerID, cfg.CronExpr, cfg.Topic, cfg.Payload, cfg.Enabled); err != nil {
			slog.Error("load cron job", "panel_id", panelID, "err", err)
		}
	}
}

// spaHandler wraps a file server to serve index.html for unknown paths (client-side routing).
func spaHandler(distFS fs.FS, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(distFS, path); err != nil {
			// File not found — serve index.html so React Router handles the path.
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			h.ServeHTTP(w, r2)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// skipLoggerForPaths wraps a chi middleware logger so it is bypassed for the given paths.
func skipLoggerForPaths(loggerMw func(http.Handler) http.Handler, paths ...string) func(http.Handler) http.Handler {
	skip := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		skip[p] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		logged := loggerMw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, ok := skip[r.URL.Path]; ok {
				next.ServeHTTP(w, r)
				return
			}
			logged.ServeHTTP(w, r)
		})
	}
}
