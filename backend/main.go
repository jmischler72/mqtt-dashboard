package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
	"mqtt-dashboard/handlers"
	mqttclient "mqtt-dashboard/mqtt"
	"mqtt-dashboard/ws"
)

//go:embed dist/*
var embeddedFiles embed.FS

func main() {
	// --- Init database ---
	if err := os.MkdirAll("./data", 0o750); err != nil {
		log.Fatalf("create data dir: %v", err)
	}
	database, err := db.InitDB("./data/mqtt-dashboard.db")
	if err != nil {
		log.Fatalf("init db: %v", err)
	}
	defer database.Close()

	// --- Init MQTT manager ---
	mqttMgr := mqttclient.NewManager()
	autoConnectFromDB(database, mqttMgr)

	// --- Init Cron scheduler ---
	scheduler, err := cron.NewScheduler(mqttMgr)
	if err != nil {
		log.Fatalf("init scheduler: %v", err)
	}
	scheduler.Start()
	defer scheduler.Stop()
	loadCronJobsFromDB(database, scheduler)

	// --- Init WebSocket hub ---
	wsHub := ws.NewHub(mqttMgr)

	// --- Init handlers ---
	configH := handlers.NewConfigHandler(database, mqttMgr)
	layoutH := handlers.NewLayoutHandler(database)
	publishH := handlers.NewPublishHandler(mqttMgr)
	cronH := handlers.NewCronHandler(database, scheduler)

	// --- Router ---
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// Health
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Config
	r.Get("/api/config", configH.GetConfig)
	r.Post("/api/config", configH.SaveConfig)
	r.Get("/api/config/status", configH.GetStatus)

	// Layouts
	r.Get("/api/layouts", layoutH.GetLayouts)
	r.Post("/api/layouts", layoutH.CreatePanel)
	r.Put("/api/layouts/batch", layoutH.BatchUpdatePositions)
	r.Put("/api/layouts/{id}", layoutH.UpdatePanel)
	r.Delete("/api/layouts/{id}", layoutH.DeletePanel)

	// Publish
	r.Post("/api/publish", publishH.Publish)

	// Cron
	r.Post("/api/cron/{panelId}", cronH.UpsertCron)
	r.Delete("/api/cron/{panelId}", cronH.DeleteCron)
	r.Put("/api/cron/{panelId}/toggle", cronH.ToggleCron)
	r.Get("/api/cron/{panelId}", cronH.GetCronStatus)

	// WebSocket
	r.Get("/ws", wsHub.ServeWS)

	// Static frontend (production only)
	if os.Getenv("APP_ENV") != "development" {
		distFS, err := fs.Sub(embeddedFiles, "dist")
		if err != nil {
			log.Fatalf("embed dist: %v", err)
		}
		r.Handle("/*", spaHandler(http.FileServer(http.FS(distFS))))
	}

	addr := ":8080"
	log.Printf("Server starting on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// autoConnectFromDB loads the active MQTT config and attempts to connect on startup.
func autoConnectFromDB(database *sql.DB, mgr *mqttclient.MQTTManager) {
	row := database.QueryRow(`SELECT host, port, client_id, username, password FROM mqtt_configurations WHERE is_active = 1 ORDER BY id DESC LIMIT 1`)
	var cfg mqttclient.ConfigRow
	if err := row.Scan(&cfg.Host, &cfg.Port, &cfg.ClientID, &cfg.Username, &cfg.Password); err != nil {
		return // No config saved yet
	}
	if err := mgr.Connect(cfg.ToModel()); err != nil {
		log.Printf("auto-connect mqtt: %v", err)
	}
}

// loadCronJobsFromDB reloads all cron panel jobs from the database on startup.
func loadCronJobsFromDB(database *sql.DB, scheduler *cron.Scheduler) {
	rows, err := database.Query(`SELECT id, COALESCE(config_json, '{}') FROM dashboard_layouts WHERE panel_type = 'cron'`)
	if err != nil {
		log.Printf("load cron jobs: %v", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var panelID, cfgJSON string
		if err := rows.Scan(&panelID, &cfgJSON); err != nil {
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
		if err := scheduler.AddJob(panelID, cfg.CronExpr, cfg.Topic, cfg.Payload, cfg.Enabled); err != nil {
			log.Printf("load cron job %q: %v", panelID, err)
		}
	}
}

// spaHandler wraps a file server to serve index.html for unknown paths (client-side routing).
func spaHandler(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r)
	})
}

// corsMiddleware allows requests from the Vite dev server.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:5173")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
