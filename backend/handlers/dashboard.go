package handlers

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mqtt-dashboard/models"
)

type DashboardHandler struct {
	db        *sql.DB
	scheduler CronScheduler
}

func NewDashboardHandler(db *sql.DB, scheduler CronScheduler) *DashboardHandler {
	return &DashboardHandler{db: db, scheduler: scheduler}
}

func (h *DashboardHandler) ListDashboards(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, name, created_at FROM dashboards ORDER BY created_at ASC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	dashboards := []models.Dashboard{}
	for rows.Next() {
		var d models.Dashboard
		if err := rows.Scan(&d.ID, &d.Name, &d.CreatedAt); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dashboards = append(dashboards, d)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dashboards)
}

func (h *DashboardHandler) CreateDashboard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	d := models.Dashboard{
		ID:   uuid.New().String(),
		Name: req.Name,
	}

	if _, err := h.db.Exec(`INSERT INTO dashboards (id, name) VALUES (?, ?)`, d.ID, d.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Read back created_at
	h.db.QueryRow(`SELECT created_at FROM dashboards WHERE id = ?`, d.ID).Scan(&d.CreatedAt) //nolint

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(d)
}

func (h *DashboardHandler) RenameDashboard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	res, err := h.db.Exec(`UPDATE dashboards SET name = ? WHERE id = ?`, req.Name, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var d models.Dashboard
	h.db.QueryRow(`SELECT id, name, created_at FROM dashboards WHERE id = ?`, id).Scan(&d.ID, &d.Name, &d.CreatedAt) //nolint

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(d)
}

// importPanel mirrors a single panel entry in an export envelope. Install-specific
// fields (id, dashboard_id) are intentionally absent; broker_id is resolved on import.
type importPanel struct {
	Title      string          `json:"title"`
	PanelType  string          `json:"panel_type"`
	X          int             `json:"x"`
	Y          int             `json:"y"`
	W          int             `json:"w"`
	H          int             `json:"h"`
	ConfigJSON json.RawMessage `json:"config_json"`
	BrokerID   string          `json:"broker_id"`
}

// ImportDashboard creates a brand-new dashboard and all of its panels from an
// export envelope, atomically. Each panel's broker_id is kept when a broker with
// that id exists locally, otherwise it falls back to the default enabled broker.
func (h *DashboardHandler) ImportDashboard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type    string        `json:"type"`
		Version int           `json:"version"`
		Name    string        `json:"name"`
		Panels  []importPanel `json:"panels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	// Accept a missing type (template payloads) but reject an explicit mismatch.
	if req.Type != "" && req.Type != "mqtt-dashboard-export" {
		http.Error(w, "unsupported import type", http.StatusBadRequest)
		return
	}
	if req.Type != "" && req.Version != 1 {
		http.Error(w, "unsupported import version", http.StatusBadRequest)
		return
	}

	// Resolve default broker once for panels whose broker_id is empty/unknown.
	var defaultBrokerID string
	h.db.QueryRow(`SELECT id FROM mqtt_brokers WHERE is_enabled = 1 ORDER BY sort_order ASC LIMIT 1`).Scan(&defaultBrokerID) //nolint

	d := models.Dashboard{
		ID:   uuid.New().String(),
		Name: req.Name,
	}

	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback() //nolint

	if _, err := tx.Exec(`INSERT INTO dashboards (id, name) VALUES (?, ?)`, d.ID, d.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Collect cron jobs to register after commit.
	type cronJob struct {
		panelID  string
		brokerID string
		cfg      cronConfig
	}
	var cronJobs []cronJob

	for _, p := range req.Panels {
		if p.PanelType == "" {
			http.Error(w, "panel_type is required for every panel", http.StatusBadRequest)
			return
		}

		// Resolve broker: keep if it exists locally, else default.
		brokerID := defaultBrokerID
		if p.BrokerID != "" {
			var exists string
			if err := tx.QueryRow(`SELECT id FROM mqtt_brokers WHERE id = ?`, p.BrokerID).Scan(&exists); err == nil {
				brokerID = p.BrokerID
			}
		}

		cfgJSON := string(p.ConfigJSON)
		if cfgJSON == "" || cfgJSON == "null" {
			cfgJSON = "{}"
		}

		title := p.Title
		if title == "" {
			title = "Panel"
		}

		panelID := uuid.New().String()
		if _, err := tx.Exec(
			`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			panelID, d.ID, title, p.PanelType, p.X, p.Y, p.W, p.H, cfgJSON, brokerID,
		); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if p.PanelType == "cron" {
			var cfg cronConfig
			if err := json.Unmarshal([]byte(cfgJSON), &cfg); err == nil && cfg.CronExpr != "" {
				cronJobs = append(cronJobs, cronJob{panelID: panelID, brokerID: brokerID, cfg: cfg})
			}
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Register cron jobs after the transaction is durably committed.
	for _, j := range cronJobs {
		if err := h.scheduler.AddJob(j.panelID, j.brokerID, j.cfg.CronExpr, j.cfg.Topic, j.cfg.Payload, byte(j.cfg.QoS), j.cfg.Retain, j.cfg.Enabled); err != nil {
			slog.Error("import: register cron job", "panel_id", j.panelID, "err", err)
		}
	}

	h.db.QueryRow(`SELECT created_at FROM dashboards WHERE id = ?`, d.ID).Scan(&d.CreatedAt) //nolint

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(d)
}

// cronConfig is the subset of a cron panel's config_json needed to schedule a job.
type cronConfig struct {
	CronExpr string `json:"cron_expr"`
	Topic    string `json:"topic"`
	Payload  string `json:"payload"`
	QoS      int    `json:"qos"`
	Retain   bool   `json:"retain"`
	Enabled  bool   `json:"enabled"`
}

func (h *DashboardHandler) DeleteDashboard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Prevent deleting the last dashboard
	var count int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM dashboards`).Scan(&count); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if count <= 1 {
		http.Error(w, "cannot delete the last dashboard", http.StatusConflict)
		return
	}

	// Collect panel IDs for cron cleanup
	rows, err := h.db.Query(`SELECT id FROM dashboard_layouts WHERE dashboard_id = ?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var panelIDs []string
	for rows.Next() {
		var pid string
		if err := rows.Scan(&pid); err != nil {
			rows.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		panelIDs = append(panelIDs, pid)
	}
	rows.Close()

	// Remove cron jobs for all panels in this dashboard
	for _, pid := range panelIDs {
		h.scheduler.RemoveJob(pid)
	}

	// Cascade delete panels then the dashboard
	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback() //nolint

	if _, err := tx.Exec(`DELETE FROM dashboard_layouts WHERE dashboard_id = ?`, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	res, err := tx.Exec(`DELETE FROM dashboards WHERE id = ?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
