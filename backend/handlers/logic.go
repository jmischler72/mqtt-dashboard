package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/logic"
)

type LogicHandler struct {
	db     *sql.DB
	engine LogicEngine
}

func NewLogicHandler(db *sql.DB, engine LogicEngine) *LogicHandler {
	return &LogicHandler{db: db, engine: engine}
}

type logicConfigJSON struct {
	BrokerID       string            `json:"broker_id,omitempty"`
	SourceBrokerID string            `json:"source_broker_id,omitempty"`
	SourceTopic    string            `json:"source_topic"`
	Match          string            `json:"match,omitempty"`
	Conditions     []logic.Condition `json:"conditions,omitempty"`
	Mode           string            `json:"mode,omitempty"`
	Count          int               `json:"count,omitempty"`
	WindowSec      int               `json:"window_sec,omitempty"`
	SustainedSec   int               `json:"sustained_sec,omitempty"`
	TargetTopic    string            `json:"target_topic"`
	TargetBrokerID string            `json:"target_broker_id,omitempty"`
	Payload        string            `json:"payload,omitempty"`
	QoS            int               `json:"qos,omitempty"`
	Retain         bool              `json:"retain,omitempty"`
	CooldownSec    int               `json:"cooldown_sec,omitempty"`
	Enabled        bool              `json:"enabled"`
}

func (h *LogicHandler) UpsertLogic(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")

	var req logicConfigJSON
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	brokerID := req.BrokerID
	if brokerID == "" {
		brokerID = req.SourceBrokerID
	}
	if brokerID == "" && len(req.Conditions) > 0 && req.Conditions[0].BrokerID != "" {
		brokerID = req.Conditions[0].BrokerID
	}
	if brokerID == "" && h.db != nil {
		_ = h.db.QueryRow(`SELECT COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, panelID).Scan(&brokerID)
	}

	sourceTopic := req.SourceTopic
	if sourceTopic == "" && len(req.Conditions) > 0 {
		sourceTopic = req.Conditions[0].Topic
	}

	rule := logic.Rule{
		PanelID:        panelID,
		BrokerID:       brokerID,
		SourceTopic:    sourceTopic,
		Match:          req.Match,
		Conditions:     req.Conditions,
		Mode:           req.Mode,
		Count:          req.Count,
		WindowSec:      req.WindowSec,
		SustainedSec:   req.SustainedSec,
		TargetTopic:    req.TargetTopic,
		TargetBrokerID: req.TargetBrokerID,
		Payload:        req.Payload,
		QoS:            byte(req.QoS),
		Retain:         req.Retain,
		CooldownSec:    req.CooldownSec,
		Enabled:        req.Enabled,
	}

	if h.engine != nil {
		if h.db != nil {
			topicsToPrime := []struct{ brokerID, topic string }{
				{brokerID: brokerID, topic: sourceTopic},
			}
			for _, c := range req.Conditions {
				cB := c.BrokerID
				if cB == "" {
					cB = brokerID
				}
				cT := c.Topic
				if cT == "" {
					cT = sourceTopic
				}
				topicsToPrime = append(topicsToPrime, struct{ brokerID, topic string }{cB, cT})
			}
			for _, item := range topicsToPrime {
				if item.topic == "" {
					continue
				}
				var payload string
				if err := h.db.QueryRow(`SELECT payload FROM mqtt_history WHERE broker_id = ? AND topic = ? ORDER BY timestamp DESC LIMIT 1`, item.brokerID, item.topic).Scan(&payload); err == nil {
					h.engine.PrimeCache(item.brokerID, item.topic, payload)
				}
			}
		}

		if err := h.engine.AddRule(&rule); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Persist to dashboard_layouts while preserving extra panel properties
	if h.db != nil {
		var existingStr string
		_ = h.db.QueryRow(`SELECT COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, panelID).Scan(&existingStr)
		var cfgMap map[string]any
		if err := json.Unmarshal([]byte(existingStr), &cfgMap); err != nil || cfgMap == nil {
			cfgMap = make(map[string]any)
		}

		cfgMap["broker_id"] = req.BrokerID
		cfgMap["source_topic"] = req.SourceTopic
		cfgMap["match"] = req.Match
		cfgMap["conditions"] = req.Conditions
		cfgMap["mode"] = req.Mode
		cfgMap["count"] = req.Count
		cfgMap["window_sec"] = req.WindowSec
		cfgMap["sustained_sec"] = req.SustainedSec
		cfgMap["target_topic"] = req.TargetTopic
		cfgMap["target_broker_id"] = req.TargetBrokerID
		cfgMap["payload"] = req.Payload
		cfgMap["qos"] = req.QoS
		cfgMap["retain"] = req.Retain
		cfgMap["cooldown_sec"] = req.CooldownSec
		cfgMap["enabled"] = req.Enabled

		b, _ := json.Marshal(cfgMap)
		if req.BrokerID != "" {
			_, _ = h.db.Exec(`UPDATE dashboard_layouts SET config_json = ?, broker_id = ? WHERE id = ?`, string(b), req.BrokerID, panelID)
		} else {
			_, _ = h.db.Exec(`UPDATE dashboard_layouts SET config_json = ? WHERE id = ?`, string(b), panelID)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *LogicHandler) DeleteLogic(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	if h.engine != nil {
		h.engine.RemoveRule(panelID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LogicHandler) ToggleLogic(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var toggleErr error
	if h.engine != nil {
		toggleErr = h.engine.ToggleRule(panelID, req.Enabled)
	}

	// If rule was not yet registered in engine, attempt lazy recovery from DB
	if toggleErr != nil && h.db != nil {
		row := h.db.QueryRow(`SELECT COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ?`, panelID)
		var cfgStr, brokerID string
		if err := row.Scan(&cfgStr, &brokerID); err == nil {
			var cfg logicConfigJSON
			if json.Unmarshal([]byte(cfgStr), &cfg) == nil && cfg.SourceTopic != "" && cfg.TargetTopic != "" {
				bID := cfg.BrokerID
				if bID == "" {
					bID = brokerID
				}
				rule := logic.Rule{
					PanelID:        panelID,
					BrokerID:       bID,
					SourceTopic:    cfg.SourceTopic,
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
					Enabled:        req.Enabled,
				}
				if h.engine != nil {
					_ = h.engine.AddRule(&rule)
				}
				toggleErr = nil
			}
		}
	}

	if toggleErr != nil {
		http.Error(w, fmt.Sprintf("rule %q not found", panelID), http.StatusNotFound)
		return
	}

	// Update enabled flag in database config_json
	if h.db != nil {
		row := h.db.QueryRow(`SELECT COALESCE(config_json, '{}') FROM dashboard_layouts WHERE id = ?`, panelID)
		var cfgStr string
		_ = row.Scan(&cfgStr)
		var cfgMap map[string]any
		if err := json.Unmarshal([]byte(cfgStr), &cfgMap); err != nil || cfgMap == nil {
			cfgMap = make(map[string]any)
		}
		cfgMap["enabled"] = req.Enabled
		b, _ := json.Marshal(cfgMap)
		_, _ = h.db.Exec(`UPDATE dashboard_layouts SET config_json = ? WHERE id = ?`, string(b), panelID)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"enabled": req.Enabled})
}

func (h *LogicHandler) GetLogicStatus(w http.ResponseWriter, r *http.Request) {
	panelID := chi.URLParam(r, "panelId")
	var status *logic.RuleStatus
	var ok bool

	if h.engine != nil {
		status, ok = h.engine.GetStatus(panelID)
	}

	if !ok && h.db != nil {
		// Attempt lazy re-registration recovery from DB
		var cfgStr, brokerID string
		if err := h.db.QueryRow(`SELECT COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE id = ? AND panel_type = 'logic'`, panelID).Scan(&cfgStr, &brokerID); err == nil {
			var cfg logicConfigJSON
			if json.Unmarshal([]byte(cfgStr), &cfg) == nil && cfg.SourceTopic != "" && cfg.TargetTopic != "" {
				bID := cfg.BrokerID
				if bID == "" {
					bID = brokerID
				}
				rule := logic.Rule{
					PanelID:        panelID,
					BrokerID:       bID,
					SourceTopic:    cfg.SourceTopic,
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
				if h.engine != nil {
					if addErr := h.engine.AddRule(&rule); addErr == nil {
						status, ok = h.engine.GetStatus(panelID)
					}
				}
			}
		}
	}

	if !ok || status == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(status)
}
