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
	db *sql.DB
}

func NewLayoutHandler(db *sql.DB) *LayoutHandler {
	return &LayoutHandler{db: db}
}

func (h *LayoutHandler) GetLayouts(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}') FROM dashboard_layouts ORDER BY y, x`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	panels := []models.DashboardPanel{}
	for rows.Next() {
		var p models.DashboardPanel
		var cfgJSON string
		if err := rows.Scan(&p.ID, &p.Title, &p.PanelType, &p.X, &p.Y, &p.W, &p.H, &cfgJSON); err != nil {
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
		Title     string `json:"title"`
		PanelType string `json:"panel_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.PanelType == "" {
		http.Error(w, "panel_type is required", http.StatusBadRequest)
		return
	}
	if req.Title == "" {
		req.Title = "New Panel"
	}

	// Find max Y to place at bottom
	var maxY int
	h.db.QueryRow(`SELECT COALESCE(MAX(y + h), 0) FROM dashboard_layouts`).Scan(&maxY) //nolint

	panel := models.DashboardPanel{
		ID:         uuid.New().String(),
		Title:      req.Title,
		PanelType:  req.PanelType,
		X:          0,
		Y:          maxY,
		W:          4,
		H:          4,
		ConfigJSON: json.RawMessage(`{}`),
	}

	_, err := h.db.Exec(
		`INSERT INTO dashboard_layouts (id, title, panel_type, x, y, w, h, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		panel.ID, panel.Title, panel.PanelType, panel.X, panel.Y, panel.W, panel.H, string(panel.ConfigJSON),
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	row := h.db.QueryRow(`SELECT id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, id)
	var p models.DashboardPanel
	var cfgJSON string
	if err := row.Scan(&p.ID, &p.Title, &p.PanelType, &p.X, &p.Y, &p.W, &p.H, &cfgJSON); err == sql.ErrNoRows {
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

	_, err := h.db.Exec(
		`UPDATE dashboard_layouts SET title=?, x=?, y=?, w=?, h=?, config_json=? WHERE id=?`,
		p.Title, p.X, p.Y, p.W, p.H, string(p.ConfigJSON), id,
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
