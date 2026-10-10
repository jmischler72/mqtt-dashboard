package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mqtt-dashboard/logic"
	"mqtt-dashboard/models"
)

type LayoutHandler struct {
	db          *sql.DB
	scheduler   CronScheduler
	logicEngine LogicEngine
	invalidator PanelMetaInvalidator
}

func NewLayoutHandler(db *sql.DB, scheduler ...CronScheduler) *LayoutHandler {
	var sched CronScheduler
	if len(scheduler) > 0 {
		sched = scheduler[0]
	}
	return &LayoutHandler{db: db, scheduler: sched}
}

func (h *LayoutHandler) SetInvalidator(invalidator PanelMetaInvalidator) {
	h.invalidator = invalidator
}

func (h *LayoutHandler) SetLogicEngine(engine LogicEngine) {
	h.logicEngine = engine
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

	if p.PanelType == "logic" && h.logicEngine != nil {
		var cfg logicConfigJSON
		if err := json.Unmarshal(p.ConfigJSON, &cfg); err == nil && (cfg.SourceTopic != "" || len(cfg.Conditions) > 0) && cfg.TargetTopic != "" {
			bID := cfg.BrokerID
			if bID == "" {
				bID = cfg.SourceBrokerID
			}
			if bID == "" && len(cfg.Conditions) > 0 && cfg.Conditions[0].BrokerID != "" {
				bID = cfg.Conditions[0].BrokerID
			}
			if bID == "" {
				bID = p.BrokerID
			}
			sTopic := cfg.SourceTopic
			if sTopic == "" && len(cfg.Conditions) > 0 {
				sTopic = cfg.Conditions[0].Topic
			}
			rule := logic.Rule{
				PanelID:        id,
				BrokerID:       bID,
				SourceTopic:    sTopic,
				Match:          cfg.Match,
				Conditions:     cfg.Conditions,
				Mode:           cfg.Mode,
				Count:          cfg.Count,
				WindowSec:      cfg.WindowSec,
				SustainedSec:   cfg.SustainedSec,
				TargetTopic:    cfg.TargetTopic,
				TargetBrokerID: cfg.TargetBrokerID,
				Payload:        cfg.Payload,
				QoS:            byte(cfg.QoS),
				Retain:         cfg.Retain,
				CooldownSec:    cfg.CooldownSec,
				Enabled:        cfg.Enabled,
			}
			_ = h.logicEngine.AddRule(&rule)
		}
	}

	if h.invalidator != nil {
		h.invalidator.InvalidatePanelMeta(id)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func (h *LayoutHandler) DeletePanel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if h.scheduler != nil {
		h.scheduler.RemoveJob(id)
	}
	if h.logicEngine != nil {
		h.logicEngine.RemoveRule(id)
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
	if h.invalidator != nil {
		h.invalidator.InvalidatePanelMeta(id)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LayoutHandler) duplicatePanelTo(srcID, targetDashboardID string, appendCopyTitle bool) (*models.DashboardPanel, error) {
	row := h.db.QueryRow(`SELECT id, dashboard_id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, srcID)
	var src models.DashboardPanel
	var cfgJSON string
	if err := row.Scan(&src.ID, &src.DashboardID, &src.Title, &src.PanelType, &src.X, &src.Y, &src.W, &src.H, &cfgJSON, &src.BrokerID); err != nil {
		return nil, err
	}
	src.ConfigJSON = json.RawMessage(cfgJSON)

	if targetDashboardID == "" {
		targetDashboardID = src.DashboardID
	}
	title := src.Title
	if appendCopyTitle {
		title += " copy"
	}

	var maxY int
	h.db.QueryRow(`SELECT COALESCE(MAX(y + h), 0) FROM dashboard_layouts WHERE dashboard_id = ?`, targetDashboardID).Scan(&maxY) //nolint

	copy_ := models.DashboardPanel{
		ID:          uuid.New().String(),
		DashboardID: targetDashboardID,
		Title:       title,
		PanelType:   src.PanelType,
		X:           src.X,
		Y:           maxY,
		W:           src.W,
		H:           src.H,
		ConfigJSON:  src.ConfigJSON,
		BrokerID:    src.BrokerID,
	}

	_, err := h.db.Exec(
		`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		copy_.ID, copy_.DashboardID, copy_.Title, copy_.PanelType, copy_.X, copy_.Y, copy_.W, copy_.H, string(copy_.ConfigJSON), copy_.BrokerID,
	)
	if err != nil {
		return nil, err
	}

	// Re-register cron job if duplicating a cron panel.
	if copy_.PanelType == "cron" && h.scheduler != nil {
		var cfg struct {
			CronExpr string `json:"cron_expr"`
			Topic    string `json:"topic"`
			Payload  string `json:"payload"`
			QoS      int    `json:"qos"`
			Retain   bool   `json:"retain"`
			Enabled  bool   `json:"enabled"`
		}
		if err := json.Unmarshal(copy_.ConfigJSON, &cfg); err == nil && cfg.CronExpr != "" {
			_ = h.scheduler.AddJob(copy_.ID, copy_.BrokerID, cfg.CronExpr, cfg.Topic, cfg.Payload, byte(cfg.QoS), cfg.Retain, cfg.Enabled)
		}
	}

	// Re-register logic rule if duplicating a logic panel.
	if copy_.PanelType == "logic" && h.logicEngine != nil {
		var cfg logicConfigJSON
		if err := json.Unmarshal(copy_.ConfigJSON, &cfg); err == nil && (cfg.SourceTopic != "" || cfg.TargetTopic != "") {
			bID := cfg.BrokerID
			if bID == "" {
				bID = copy_.BrokerID
			}
			sTopic := cfg.SourceTopic
			if sTopic == "" && len(cfg.Conditions) > 0 {
				sTopic = cfg.Conditions[0].Topic
			}
			rule := logic.Rule{
				PanelID:        copy_.ID,
				BrokerID:       bID,
				SourceTopic:    sTopic,
				Match:          cfg.Match,
				Conditions:     cfg.Conditions,
				Mode:           cfg.Mode,
				Count:          cfg.Count,
				WindowSec:      cfg.WindowSec,
				SustainedSec:   cfg.SustainedSec,
				TargetTopic:    cfg.TargetTopic,
				TargetBrokerID: cfg.TargetBrokerID,
				Payload:        cfg.Payload,
				QoS:            byte(cfg.QoS),
				Retain:         cfg.Retain,
				CooldownSec:    cfg.CooldownSec,
				Enabled:        cfg.Enabled,
			}
			_ = h.logicEngine.AddRule(&rule)
		}
	}

	return &copy_, nil
}

func (h *LayoutHandler) DuplicatePanel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	copy_, err := h.duplicatePanelTo(id, "", true)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(copy_)
}

func (h *LayoutHandler) MovePanel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		DashboardID string `json:"dashboard_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DashboardID == "" {
		http.Error(w, "dashboard_id is required", http.StatusBadRequest)
		return
	}

	// Verify target dashboard exists.
	var exists string
	if err := h.db.QueryRow(`SELECT id FROM dashboards WHERE id = ?`, req.DashboardID).Scan(&exists); err != nil {
		http.Error(w, "target dashboard not found", http.StatusNotFound)
		return
	}

	row := h.db.QueryRow(`SELECT id, dashboard_id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, id)
	var p models.DashboardPanel
	var cfgJSON string
	if err := row.Scan(&p.ID, &p.DashboardID, &p.Title, &p.PanelType, &p.X, &p.Y, &p.W, &p.H, &cfgJSON, &p.BrokerID); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	p.ConfigJSON = json.RawMessage(cfgJSON)

	if p.DashboardID == req.DashboardID {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(p)
		return
	}

	// Place at the bottom of the target dashboard.
	var maxY int
	h.db.QueryRow(`SELECT COALESCE(MAX(y + h), 0) FROM dashboard_layouts WHERE dashboard_id = ?`, req.DashboardID).Scan(&maxY) //nolint

	p.DashboardID = req.DashboardID
	p.Y = maxY

	_, err := h.db.Exec(
		`UPDATE dashboard_layouts SET dashboard_id = ?, y = ? WHERE id = ?`,
		p.DashboardID, p.Y, id,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if h.invalidator != nil {
		h.invalidator.InvalidatePanelMeta(id)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func (h *LayoutHandler) CopyPanelTo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		DashboardID string `json:"dashboard_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DashboardID == "" {
		http.Error(w, "dashboard_id is required", http.StatusBadRequest)
		return
	}

	// Verify target dashboard exists.
	var exists string
	if err := h.db.QueryRow(`SELECT id FROM dashboards WHERE id = ?`, req.DashboardID).Scan(&exists); err != nil {
		http.Error(w, "target dashboard not found", http.StatusNotFound)
		return
	}

	copy_, err := h.duplicatePanelTo(id, req.DashboardID, false)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(copy_)
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
