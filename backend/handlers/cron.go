package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
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

	if err := h.scheduler.AddJob(panelID, req.BrokerID, req.CronExpr, req.Topic, req.Payload, byte(req.QoS), req.Retain, req.Enabled); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Persist config_json on the panel row
	b, _ := json.Marshal(req)
	h.db.Exec(`UPDATE dashboard_layouts SET config_json = ? WHERE id = ?`, string(b), panelID) //nolint

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *CronHandler) DeleteCron(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	h.scheduler.RemoveJob(panelID)
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

	// Update enabled in config_json
	row := h.db.QueryRow(`SELECT COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, panelID)
	var cfgStr string
	row.Scan(&cfgStr) //nolint
	var cfg cronConfigJSON
	json.Unmarshal([]byte(cfgStr), &cfg) //nolint
	cfg.Enabled = req.Enabled
	b, _ := json.Marshal(cfg)
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
