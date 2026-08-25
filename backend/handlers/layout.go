package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mqtt-dashboard/models"
)

type LayoutHandler struct {
	db        *sql.DB
	scheduler CronScheduler
}

func NewLayoutHandler(db *sql.DB, scheduler ...CronScheduler) *LayoutHandler {
	var sched CronScheduler
	if len(scheduler) > 0 {
		sched = scheduler[0]
	}
	return &LayoutHandler{db: db, scheduler: sched}
}

func (h *LayoutHandler) GetLayouts(w http.ResponseWriter, r *http.Request) {
	dashboardID := r.URL.Query().Get("dashboard_id")

	var rows *sql.Rows
	var err error
	if dashboardID != "" {
		rows, err = h.db.Query(`SELECT id, dashboard_id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE dashboard_id = ? ORDER BY y, x`, dashboardID)
	} else {
		rows, err = h.db.Query(`SELECT id, dashboard_id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts ORDER BY y, x`)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	panels := []models.DashboardPanel{}
	for rows.Next() {
		var p models.DashboardPanel
		var cfgJSON string
		if err := rows.Scan(&p.ID, &p.DashboardID, &p.Title, &p.PanelType, &p.X, &p.Y, &p.W, &p.H, &cfgJSON, &p.BrokerID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		p.ConfigJSON = json.RawMessage(cfgJSON)
		panels = append(panels, p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(panels)
}

func (h *LayoutHandler) CreatePanel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DashboardID string `json:"dashboard_id"`
		Title       string `json:"title"`
		PanelType   string `json:"panel_type"`
		X           *int   `json:"x"`
		Y           *int   `json:"y"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.PanelType == "" {
		http.Error(w, "panel_type is required", http.StatusBadRequest)
		return
	}
	if req.DashboardID == "" {
		http.Error(w, "dashboard_id is required", http.StatusBadRequest)
		return
	}
	if req.Title == "" {
		req.Title = "New Panel"
	}

	// Find max Y within this dashboard to place at bottom when y is not provided
	var maxY int
	h.db.QueryRow(`SELECT COALESCE(MAX(y + h), 0) FROM dashboard_layouts WHERE dashboard_id = ?`, req.DashboardID).Scan(&maxY) //nolint

	x := 0
	if req.X != nil && *req.X >= 0 {
		x = *req.X
	}
	if x > 8 {
		x = 8
	}

	y := maxY
	if req.Y != nil && *req.Y >= 0 {
		y = *req.Y
	}

	// Auto-assign default broker
	var defaultBrokerID string
	h.db.QueryRow(`SELECT id FROM mqtt_brokers WHERE is_enabled = 1 ORDER BY sort_order ASC LIMIT 1`).Scan(&defaultBrokerID) //nolint

	w_, h_ := 4, 3
	if req.PanelType == "separator" {
		w_, h_ = 4, 1
	}

	panel := models.DashboardPanel{
		ID:          uuid.New().String(),
		DashboardID: req.DashboardID,
		Title:       req.Title,
		PanelType:   req.PanelType,
		X:           x,
		Y:           y,
		W:           w_,
		H:           h_,
		ConfigJSON:  json.RawMessage(`{}`),
		BrokerID:    defaultBrokerID,
	}

	_, err := h.db.Exec(
		`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		panel.ID, panel.DashboardID, panel.Title, panel.PanelType, panel.X, panel.Y, panel.W, panel.H, string(panel.ConfigJSON), panel.BrokerID,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(panel)
}

func (h *LayoutHandler) UpdatePanel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Title      *string          `json:"title"`
		X          *int             `json:"x"`
		Y          *int             `json:"y"`
		W          *int             `json:"w"`
		H          *int             `json:"h"`
		ConfigJSON *json.RawMessage `json:"config_json"`
		BrokerID   *string          `json:"broker_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	row := h.db.QueryRow(`SELECT id, dashboard_id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, id)
	var p models.DashboardPanel
	var cfgJSON string
	if err := row.Scan(&p.ID, &p.DashboardID, &p.Title, &p.PanelType, &p.X, &p.Y, &p.W, &p.H, &cfgJSON, &p.BrokerID); err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p.ConfigJSON = json.RawMessage(cfgJSON)

	if req.Title != nil {
		p.Title = *req.Title
	}
	if req.X != nil {
		p.X = *req.X
	}
	if req.Y != nil {
		p.Y = *req.Y
	}
	if req.W != nil {
		p.W = *req.W
	}
	if req.H != nil {
		p.H = *req.H
	}
	if req.ConfigJSON != nil {
		p.ConfigJSON = *req.ConfigJSON
	}
	if req.BrokerID != nil {
		p.BrokerID = *req.BrokerID
	}

	_, err := h.db.Exec(
		`UPDATE dashboard_layouts SET title=?, x=?, y=?, w=?, h=?, config_json=?, broker_id=? WHERE id=?`,
		p.Title, p.X, p.Y, p.W, p.H, string(p.ConfigJSON), p.BrokerID, id,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func (h *LayoutHandler) DeletePanel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if h.scheduler != nil {
		h.scheduler.RemoveJob(id)
	}
	res, err := h.db.Exec(`DELETE FROM dashboard_layouts WHERE id = ?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LayoutHandler) BatchUpdatePositions(w http.ResponseWriter, r *http.Request) {
	var req models.BatchLayoutUpdate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback() //nolint

	stmt, err := tx.Prepare(`UPDATE dashboard_layouts SET x=?, y=?, w=?, h=? WHERE id=?`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	for _, p := range req.Panels {
		if _, err := stmt.Exec(p.X, p.Y, p.W, p.H, p.ID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
