package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/logic"
)

// AutomationItem represents a single automation across any action panel type.
type AutomationItem struct {
	PanelID        string     `json:"panel_id"`
	PanelTitle     string     `json:"panel_title"`
	PanelType      string     `json:"panel_type"` // "cron", "logic", etc.
	DashboardID    string     `json:"dashboard_id"`
	DashboardName  string     `json:"dashboard_name"`
	BrokerID       string     `json:"broker_id"`
	BrokerName     string     `json:"broker_name"`
	Enabled        bool       `json:"enabled"`
	TargetTopic    string     `json:"target_topic"`           // Action/publish topic
	SourceTopic    string     `json:"source_topic,omitempty"` // Trigger topic (for event-driven)
	Payload        string     `json:"payload,omitempty"`
	QoS            byte       `json:"qos"`
	Retain         bool       `json:"retain"`
	TriggerType    string     `json:"trigger_type"`    // "schedule" | "event" | "manual"
	TriggerSummary string     `json:"trigger_summary"` // e.g. "Every 5 minutes", "On change"
	TriggerDetail  string     `json:"trigger_detail"`  // e.g. "*/5 * * * *", "2 conditions"
	NextRun        *time.Time `json:"next_run,omitempty"`
	LastRun        *time.Time `json:"last_run,omitempty"`
	RunCount       int        `json:"run_count,omitempty"`
	StatusDetail   string     `json:"status_detail,omitempty"`
}

// PanelLayoutRow holds database layout information for an automation panel.
type PanelLayoutRow struct {
	PanelID        string
	PanelTitle     string
	PanelType      string
	DashboardID    string
	DashboardName  string
	LayoutBrokerID string
	ConfigJSON     string
}

// AutomationProvider generates automation telemetry and handles toggle for a specific panel type.
type AutomationProvider interface {
	PanelType() string
	BuildItem(row PanelLayoutRow, brokerNames map[string]string, defaultBrokerID, defaultBrokerName string) (*AutomationItem, bool)
	Toggle(panelID string, enabled bool) error
}

// CronAutomationProvider handles automations for "cron" panels.
type CronAutomationProvider struct {
	db        *sql.DB
	scheduler CronScheduler
}

func NewCronAutomationProvider(db *sql.DB, scheduler CronScheduler) *CronAutomationProvider {
	return &CronAutomationProvider{db: db, scheduler: scheduler}
}

func (p *CronAutomationProvider) PanelType() string {
	return "cron"
}

func (p *CronAutomationProvider) BuildItem(row PanelLayoutRow, brokerNames map[string]string, defaultBrokerID, defaultBrokerName string) (*AutomationItem, bool) {
	var cfg cronConfigJSON
	if err := json.Unmarshal([]byte(row.ConfigJSON), &cfg); err != nil {
		return nil, false
	}
	if cfg.CronExpr == "" && cfg.Topic == "" {
		return nil, false
	}

	brokerID := cfg.BrokerID
	if brokerID == "" {
		brokerID = row.LayoutBrokerID
	}
	if brokerID == "" {
		brokerID = defaultBrokerID
	}
	brokerName := brokerNames[brokerID]
	if brokerName == "" && brokerID == defaultBrokerID {
		brokerName = defaultBrokerName
	}

	item := &AutomationItem{
		PanelID:        row.PanelID,
		PanelTitle:     row.PanelTitle,
		PanelType:      "cron",
		DashboardID:    row.DashboardID,
		DashboardName:  row.DashboardName,
		BrokerID:       brokerID,
		BrokerName:     brokerName,
		Enabled:        cfg.Enabled,
		TargetTopic:    cfg.Topic,
		Payload:        cfg.Payload,
		QoS:            byte(cfg.QoS),
		Retain:         cfg.Retain,
		TriggerType:    "schedule",
		TriggerSummary: cfg.CronExpr,
		TriggerDetail:  cfg.CronExpr,
	}

	if p.scheduler != nil {
		if info, ok := p.scheduler.GetJob(row.PanelID); ok {
			item.Enabled = info.Enabled
			if !info.NextRun.IsZero() {
				item.NextRun = &info.NextRun
			}
			if !info.PrevRun.IsZero() {
				item.LastRun = &info.PrevRun
			}
		}
	}

	return item, true
}

func (p *CronAutomationProvider) Toggle(panelID string, enabled bool) error {
	if p.scheduler == nil {
		return nil
	}
	if err := p.scheduler.ToggleJob(panelID, enabled); err != nil {
		// Attempt lazy recovery from DB if not in scheduler
		if p.db != nil {
			row := p.db.QueryRow(`SELECT COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, panelID)
			var cfgStr, layoutBrokerID string
			if dbErr := row.Scan(&cfgStr, &layoutBrokerID); dbErr == nil {
				var cfg cronConfigJSON
				_ = json.Unmarshal([]byte(cfgStr), &cfg)
				if cfg.CronExpr != "" {
					bID := cfg.BrokerID
					if bID == "" {
						bID = layoutBrokerID
					}
					return p.scheduler.AddJob(panelID, bID, cfg.CronExpr, cfg.Topic, cfg.Payload, byte(cfg.QoS), cfg.Retain, enabled)
				}
			}
		}
		return err
	}
	return nil
}

// LogicAutomationProvider handles automations for "logic" panels.
type LogicAutomationProvider struct {
	db     *sql.DB
	engine LogicEngine
}

func NewLogicAutomationProvider(db *sql.DB, engine LogicEngine) *LogicAutomationProvider {
	return &LogicAutomationProvider{db: db, engine: engine}
}

func (p *LogicAutomationProvider) PanelType() string {
	return "logic"
}

func (p *LogicAutomationProvider) BuildItem(row PanelLayoutRow, brokerNames map[string]string, defaultBrokerID, defaultBrokerName string) (*AutomationItem, bool) {
	var cfg logicConfigJSON
	if err := json.Unmarshal([]byte(row.ConfigJSON), &cfg); err != nil {
		return nil, false
	}

	sourceTopic := cfg.SourceTopic
	if sourceTopic == "" && len(cfg.Conditions) > 0 {
		sourceTopic = cfg.Conditions[0].Topic
	}

	if cfg.TargetTopic == "" && sourceTopic == "" {
		return nil, false
	}

	brokerID := cfg.TargetBrokerID
	if brokerID == "" {
		brokerID = cfg.BrokerID
	}
	if brokerID == "" {
		brokerID = cfg.SourceBrokerID
	}
	if brokerID == "" && len(cfg.Conditions) > 0 && cfg.Conditions[0].BrokerID != "" {
		brokerID = cfg.Conditions[0].BrokerID
	}
	if brokerID == "" {
		brokerID = row.LayoutBrokerID
	}
	if brokerID == "" {
		brokerID = defaultBrokerID
	}
	brokerName := brokerNames[brokerID]
	if brokerName == "" && brokerID == defaultBrokerID {
		brokerName = defaultBrokerName
	}

	mode := cfg.Mode
	if mode == "" {
		mode = "on_change"
	}

	condCount := len(cfg.Conditions)
	condSummary := fmt.Sprintf("%d condition", condCount)
	if condCount != 1 {
		condSummary = fmt.Sprintf("%d conditions", condCount)
	}

	item := &AutomationItem{
		PanelID:        row.PanelID,
		PanelTitle:     row.PanelTitle,
		PanelType:      "logic",
		DashboardID:    row.DashboardID,
		DashboardName:  row.DashboardName,
		BrokerID:       brokerID,
		BrokerName:     brokerName,
		Enabled:        cfg.Enabled,
		TargetTopic:    cfg.TargetTopic,
		SourceTopic:    sourceTopic,
		Payload:        cfg.Payload,
		QoS:            byte(cfg.QoS),
		Retain:         cfg.Retain,
		TriggerType:    "event",
		TriggerSummary: mode,
		TriggerDetail:  condSummary,
	}

	if p.engine != nil {
		if status, ok := p.engine.GetStatus(row.PanelID); ok && status != nil {
			item.Enabled = status.Enabled
			item.RunCount = status.FireCount
			item.StatusDetail = status.CurrentState
			if status.LastFired != nil && !status.LastFired.IsZero() {
				item.LastRun = status.LastFired
			}
		}
	}

	return item, true
}

func (p *LogicAutomationProvider) Toggle(panelID string, enabled bool) error {
	if p.engine == nil {
		return nil
	}
	err := p.engine.ToggleRule(panelID, enabled)
	if err != nil && p.db != nil {
		// Attempt lazy re-registration recovery from DB
		var cfgStr, layoutBrokerID string
		if dbErr := p.db.QueryRow(`SELECT COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, panelID).Scan(&cfgStr, &layoutBrokerID); dbErr == nil {
			var cfg logicConfigJSON
			if json.Unmarshal([]byte(cfgStr), &cfg) == nil && (cfg.TargetTopic != "" || cfg.SourceTopic != "") {
				bID := cfg.BrokerID
				if bID == "" {
					bID = layoutBrokerID
				}
				sTopic := cfg.SourceTopic
				if sTopic == "" && len(cfg.Conditions) > 0 {
					sTopic = cfg.Conditions[0].Topic
				}
				rule := logic.Rule{
					PanelID:        panelID,
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
					Enabled:        enabled,
				}
				if addErr := p.engine.AddRule(&rule); addErr == nil {
					return nil
				}
			}
		}
	}
	return err
}

// AutomationsHandler aggregates automations across all registered action providers.
type AutomationsHandler struct {
	db        *sql.DB
	providers map[string]AutomationProvider
}

func NewAutomationsHandler(db *sql.DB, providers ...AutomationProvider) *AutomationsHandler {
	m := make(map[string]AutomationProvider)
	for _, p := range providers {
		m[p.PanelType()] = p
	}
	return &AutomationsHandler{
		db:        db,
		providers: m,
	}
}

func (h *AutomationsHandler) RegisterProvider(provider AutomationProvider) {
	h.providers[provider.PanelType()] = provider
}

func (h *AutomationsHandler) ListAutomations(w http.ResponseWriter, r *http.Request) {
	enabledOnly := r.URL.Query().Get("enabled") == "true"

	// Fetch brokers to map broker IDs to names
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

	if len(h.providers) == 0 {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]AutomationItem{})
		return
	}

	// Prepare IN query for registered panel types
	placeholders := make([]string, 0, len(h.providers))
	args := make([]any, 0, len(h.providers))
	for pt := range h.providers {
		placeholders = append(placeholders, "?")
		args = append(args, pt)
	}

	query := fmt.Sprintf(`
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
		WHERE l.panel_type IN (%s)
		ORDER BY l.title ASC
	`, strings.Join(placeholders, ", "))

	rows, err := h.db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]AutomationItem, 0)
	for rows.Next() {
		var row PanelLayoutRow
		if err := rows.Scan(&row.PanelID, &row.PanelTitle, &row.PanelType, &row.DashboardID, &row.DashboardName, &row.LayoutBrokerID, &row.ConfigJSON); err != nil {
			continue
		}
		if row.DashboardID == "" {
			row.DashboardID = "default"
		}

		provider, ok := h.providers[row.PanelType]
		if !ok {
			continue
		}

		item, ok := provider.BuildItem(row, brokerNames, defaultBrokerID, defaultBrokerName)
		if !ok || item == nil {
			continue
		}

		if enabledOnly && !item.Enabled {
			continue
		}

		items = append(items, *item)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

func (h *AutomationsHandler) ToggleAutomation(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var panelType string
	if err := h.db.QueryRow(`SELECT panel_type FROM dashboard_layouts WHERE id = ?`, panelID).Scan(&panelType); err != nil {
		http.Error(w, "automation not found", http.StatusNotFound)
		return
	}

	provider, ok := h.providers[panelType]
	if !ok {
		http.Error(w, fmt.Sprintf("unsupported automation type %q", panelType), http.StatusBadRequest)
		return
	}

	if err := provider.Toggle(panelID, req.Enabled); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Update config_json.enabled in database
	var cfgStr string
	_ = h.db.QueryRow(`SELECT COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, panelID).Scan(&cfgStr)
	var cfgMap map[string]any
	if err := json.Unmarshal([]byte(cfgStr), &cfgMap); err != nil || cfgMap == nil {
		cfgMap = make(map[string]any)
	}
	cfgMap["enabled"] = req.Enabled
	b, _ := json.Marshal(cfgMap)
	_, _ = h.db.Exec(`UPDATE dashboard_layouts SET config_json = ? WHERE id = ?`, string(b), panelID)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"enabled":    req.Enabled,
		"panel_type": panelType,
	})
}
