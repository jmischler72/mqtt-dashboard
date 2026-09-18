package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/cron"
)

type CronHandler struct {
	db        *sql.DB
	scheduler CronScheduler
}

func NewCronHandler(db *sql.DB, scheduler CronScheduler) *CronHandler {
	return &CronHandler{db: db, scheduler: scheduler}
}

type cronConfigJSON struct {
	BrokerID string `json:"broker_id"`
	CronExpr string `json:"cron_expr"`
	Topic    string `json:"topic"`
	Payload  string `json:"payload"`
	QoS      int    `json:"qos"`
	Retain   bool   `json:"retain"`
	Enabled  bool   `json:"enabled"`
}

func (h *CronHandler) UpsertCron(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")

	var req cronConfigJSON
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Topic == "" || req.CronExpr == "" {
		http.Error(w, "topic and cron_expr are required", http.StatusBadRequest)
		return
	}
	if strings.Contains(req.Topic, "+") || strings.Contains(req.Topic, "#") {
		http.Error(w, "wildcards (+ or #) are not supported for cron publishing", http.StatusBadRequest)
		return
	}

	if err := h.scheduler.AddJob(panelID, req.BrokerID, req.CronExpr, req.Topic, req.Payload, byte(req.QoS), req.Retain, req.Enabled); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Persist config_json on the panel row while preserving metadata (e.g. header_meta_pinned)
	var existingStr string
	h.db.QueryRow(`SELECT COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, panelID).Scan(&existingStr) //nolint
	var cfgMap map[string]any
	if err := json.Unmarshal([]byte(existingStr), &cfgMap); err != nil || cfgMap == nil {
		cfgMap = make(map[string]any)
	}
	cfgMap["broker_id"] = req.BrokerID
	cfgMap["cron_expr"] = req.CronExpr
	cfgMap["topic"] = req.Topic
	cfgMap["payload"] = req.Payload
	cfgMap["qos"] = req.QoS
	cfgMap["retain"] = req.Retain
	cfgMap["enabled"] = req.Enabled
	b, _ := json.Marshal(cfgMap)
	h.db.Exec(`UPDATE dashboard_layouts SET config_json = ? WHERE id = ?`, string(b), panelID) //nolint

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *CronHandler) DeleteCron(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	if h.scheduler != nil {
		h.scheduler.RemoveJob(panelID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CronHandler) ToggleCron(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Try toggling in scheduler first if already registered
	if err := h.scheduler.ToggleJob(panelID, req.Enabled); err != nil {
		// Recover job from database layout if not currently in scheduler
		row := h.db.QueryRow(`SELECT COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, panelID)
		var cfgStr, brokerID string
		if dbErr := row.Scan(&cfgStr, &brokerID); dbErr != nil {
			http.Error(w, "job not found", http.StatusNotFound)
			return
		}

		var cfg cronConfigJSON
		_ = json.Unmarshal([]byte(cfgStr), &cfg)
		if cfg.CronExpr == "" {
			http.Error(w, "cron expression is required", http.StatusBadRequest)
			return
		}
		if cfg.BrokerID == "" {
			cfg.BrokerID = brokerID
		}

		if addErr := h.scheduler.AddJob(panelID, cfg.BrokerID, cfg.CronExpr, cfg.Topic, cfg.Payload, byte(cfg.QoS), cfg.Retain, req.Enabled); addErr != nil {
			http.Error(w, addErr.Error(), http.StatusBadRequest)
			return
		}
	}

	// Update enabled in config_json while preserving any other panel properties
	row := h.db.QueryRow(`SELECT COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, panelID)
	var cfgStr string
	row.Scan(&cfgStr) //nolint
	var cfgMap map[string]any
	if err := json.Unmarshal([]byte(cfgStr), &cfgMap); err != nil || cfgMap == nil {
		cfgMap = make(map[string]any)
	}
	cfgMap["enabled"] = req.Enabled
	b, _ := json.Marshal(cfgMap)
	h.db.Exec(`UPDATE dashboard_layouts SET config_json = ? WHERE id = ?`, string(b), panelID) //nolint

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"enabled": req.Enabled})
}

func (h *CronHandler) GetCronStatus(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	info, ok := h.scheduler.GetJob(panelID)
	if !ok {
		// Attempt to recover job from database layout if not currently in scheduler
		var cfgStr, brokerID string
		if err := h.db.QueryRow(`SELECT COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ? AND panel_type = 'cron'`, panelID).Scan(&cfgStr, &brokerID); err == nil {
			var cfg cronConfigJSON
			if json.Unmarshal([]byte(cfgStr), &cfg) == nil && cfg.CronExpr != "" {
				if cfg.BrokerID == "" {
					cfg.BrokerID = brokerID
				}
				if err := h.scheduler.AddJob(panelID, cfg.BrokerID, cfg.CronExpr, cfg.Topic, cfg.Payload, byte(cfg.QoS), cfg.Retain, cfg.Enabled); err == nil {
					info, ok = h.scheduler.GetJob(panelID)
				}
			}
		}
	}
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}

type ScheduledJobItem struct {
	PanelID       string     `json:"panel_id"`
	PanelTitle    string     `json:"panel_title"`
	PanelType     string     `json:"panel_type"`
	DashboardID   string     `json:"dashboard_id"`
	DashboardName string     `json:"dashboard_name"`
	BrokerID      string     `json:"broker_id"`
	BrokerName    string     `json:"broker_name"`
	CronExpr      string     `json:"cron_expr"`
	Topic         string     `json:"topic"`
	Payload       string     `json:"payload"`
	QoS           byte       `json:"qos"`
	Retain        bool       `json:"retain"`
	Enabled       bool       `json:"enabled"`
	NextRun       *time.Time `json:"next_run,omitempty"`
	PrevRun       *time.Time `json:"prev_run,omitempty"`
}

func (h *CronHandler) ListCronJobs(w http.ResponseWriter, r *http.Request) {
	enabledOnly := r.URL.Query().Get("enabled") == "true"

	// Fetch brokers to resolve broker IDs to broker names
	brokerNames := make(map[string]string)
	var defaultBrokerID, defaultBrokerName string
	bRows, err := h.db.Query(`SELECT id, name, is_enabled FROM mqtt_brokers ORDER BY sort_order ASC`)
	if err == nil {
		defer bRows.Close()
		for bRows.Next() {
			var id, name string
			var isEnabled bool
			if bRows.Scan(&id, &name, &isEnabled) == nil {
				brokerNames[id] = name
				if isEnabled && defaultBrokerID == "" {
					defaultBrokerID = id
					defaultBrokerName = name
				}
			}
		}
	}

	rows, err := h.db.Query(`
		SELECT
			l.id,
			l.title,
			l.panel_type,
			l.dashboard_id,
			COALESCE(NULLIF(d.name, ''), 'Default'),
			COALESCE(l.broker_id, ''),
			COALESCE(l.config_json, '{}')
		FROM dashboard_layouts l
		LEFT JOIN dashboards d ON l.dashboard_id = d.id
		WHERE l.panel_type = 'cron'
		ORDER BY l.title ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	schedJobMap := make(map[string]*cron.JobInfo)
	if h.scheduler != nil {
		for _, j := range h.scheduler.GetJobs() {
			schedJobMap[j.PanelID] = j
		}
	}

	jobs := make([]ScheduledJobItem, 0)
	for rows.Next() {
		var panelID, panelTitle, panelType, dashboardID, dashboardName, layoutBrokerID, cfgStr string
		if err := rows.Scan(&panelID, &panelTitle, &panelType, &dashboardID, &dashboardName, &layoutBrokerID, &cfgStr); err != nil {
			continue
		}

		var cfg cronConfigJSON
		if err := json.Unmarshal([]byte(cfgStr), &cfg); err != nil {
			continue
		}
		// Only list configured jobs that have at least a cron_expr or topic
		if cfg.CronExpr == "" && cfg.Topic == "" {
			continue
		}

		if dashboardID == "" {
			dashboardID = "default"
		}

		brokerID := cfg.BrokerID
		if brokerID == "" {
			brokerID = layoutBrokerID
		}
		if brokerID == "" {
			brokerID = defaultBrokerID
		}
		brokerName := brokerNames[brokerID]
		if brokerName == "" && brokerID == defaultBrokerID {
			brokerName = defaultBrokerName
		}

		item := ScheduledJobItem{
			PanelID:       panelID,
			PanelTitle:    panelTitle,
			PanelType:     panelType,
			DashboardID:   dashboardID,
			DashboardName: dashboardName,
			BrokerID:      brokerID,
			BrokerName:    brokerName,
			CronExpr:      cfg.CronExpr,
			Topic:         cfg.Topic,
			Payload:       cfg.Payload,
			QoS:           byte(cfg.QoS),
			Retain:        cfg.Retain,
			Enabled:       cfg.Enabled,
		}

		if info, ok := schedJobMap[panelID]; ok {
			item.Enabled = info.Enabled
			if !info.NextRun.IsZero() {
				item.NextRun = &info.NextRun
			}
			if !info.PrevRun.IsZero() {
				item.PrevRun = &info.PrevRun
			}
		}

		if enabledOnly && !item.Enabled {
			continue
		}

		jobs = append(jobs, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}
