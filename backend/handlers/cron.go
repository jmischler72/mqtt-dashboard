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

	if err := h.scheduler.AddJob(panelID, req.BrokerID, req.CronExpr, req.Topic, req.Payload, req.Enabled); err != nil {
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
	if err := h.scheduler.ToggleJob(panelID, req.Enabled); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
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
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(info)
}
