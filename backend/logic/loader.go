package logic

import (
	"database/sql"
	"encoding/json"
	"log/slog"
)

// LoadRulesFromDB reloads all logic panel rules from the database into the logic engine.
func LoadRulesFromDB(database *sql.DB, engine LogicEngine) {
	rows, err := database.Query(`SELECT id, COALESCE(config_json, '{}'), COALESCE(broker_id, '') FROM dashboard_layouts WHERE panel_type = 'logic'`)
	if err != nil {
		slog.Error("load logic rules", "err", err)
		return
	}
	type rawLogicRow struct {
		panelID  string
		cfgJSON  string
		brokerID string
	}
	var loaded []rawLogicRow
	for rows.Next() {
		var r rawLogicRow
		if err := rows.Scan(&r.panelID, &r.cfgJSON, &r.brokerID); err == nil {
			loaded = append(loaded, r)
		}
	}
	_ = rows.Close()

	for _, item := range loaded {
		var rule Rule
		if err := json.Unmarshal([]byte(item.cfgJSON), &rule); err != nil || rule.SourceTopic == "" || rule.TargetTopic == "" {
			continue
		}
		rule.PanelID = item.panelID
		if rule.BrokerID == "" {
			rule.BrokerID = item.brokerID
		}
		// Prime cache from history for source topic and all condition topics
		top := rule.SourceTopic
		if top == "" && len(rule.Conditions) > 0 {
			top = rule.Conditions[0].Topic
		}
		if top != "" {
			var payload string
			if err := database.QueryRow(`SELECT payload FROM mqtt_history WHERE broker_id = ? AND topic = ? ORDER BY timestamp DESC LIMIT 1`, rule.BrokerID, top).Scan(&payload); err == nil {
				engine.PrimeCache(rule.BrokerID, top, payload)
			}
		}
		for _, c := range rule.Conditions {
			cB := c.BrokerID
			if cB == "" {
				cB = rule.BrokerID
			}
			cT := c.Topic
			if cT != "" {
				var payload string
				if err := database.QueryRow(`SELECT payload FROM mqtt_history WHERE broker_id = ? AND topic = ? ORDER BY timestamp DESC LIMIT 1`, cB, cT).Scan(&payload); err == nil {
					engine.PrimeCache(cB, cT, payload)
				}
			}
		}
		if err := engine.AddRule(&rule); err != nil {
			slog.Error("load logic rule", "panel_id", item.panelID, "err", err)
		}
	}
}
