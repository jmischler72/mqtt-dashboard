package handlers

import (
	"database/sql"
	"encoding/json"
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
