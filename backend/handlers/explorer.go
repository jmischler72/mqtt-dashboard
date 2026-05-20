package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	mqttutil "mqtt-dashboard/mqtt"
	"mqtt-dashboard/models"
)

type ExplorerHandler struct {
	db *sql.DB
}

func NewExplorerHandler(db *sql.DB) *ExplorerHandler {
	return &ExplorerHandler{db: db}
}

// GetTree returns a distinct flat list of all topics captured in the last 24 hours for a broker.
func (h *ExplorerHandler) GetTree(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	if brokerID == "" {
		http.Error(w, "broker_id required", http.StatusBadRequest)
		return
	}

	rows, err := h.db.Query(
		`SELECT DISTINCT topic FROM mqtt_history WHERE broker_id = ? AND timestamp > DATETIME('now', '-24 hours') ORDER BY topic ASC`,
		brokerID,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	topics := []string{}
	for rows.Next() {
		var topic string
		if err := rows.Scan(&topic); err != nil {
			continue
		}
		topics = append(topics, topic)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(topics)
}

// GetHistory returns all history records for a specific broker + topic within the retention window.
func (h *ExplorerHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	topic := r.URL.Query().Get("topic")
	if brokerID == "" || topic == "" {
		http.Error(w, "broker_id and topic required", http.StatusBadRequest)
		return
	}

	var retentionHours int
	row := h.db.QueryRow(`SELECT retention_period_hours FROM app_settings WHERE id = 1`)
	if err := row.Scan(&retentionHours); err != nil || retentionHours < 24 {
		retentionHours = 24
	}

	var rows *sql.Rows
	var err error
	if mqttutil.HasWildcard(topic) {
		likePattern := mqttutil.ToSQLLikePattern(topic)
		rows, err = h.db.Query(
			`SELECT id, broker_id, topic, COALESCE(payload, ''), timestamp FROM mqtt_history
			 WHERE broker_id = ? AND topic LIKE ? AND timestamp > DATETIME('now', '-' || ? || ' hours')
			 ORDER BY timestamp ASC`,
			brokerID, likePattern, retentionHours,
		)
	} else {
		rows, err = h.db.Query(
			`SELECT id, broker_id, topic, COALESCE(payload, ''), timestamp FROM mqtt_history
			 WHERE broker_id = ? AND topic = ? AND timestamp > DATETIME('now', '-' || ? || ' hours')
			 ORDER BY timestamp ASC`,
			brokerID, topic, retentionHours,
		)
	}
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	records := []models.MQTTHistoryRecord{}
	for rows.Next() {
		var rec models.MQTTHistoryRecord
		if err := rows.Scan(&rec.ID, &rec.BrokerID, &rec.Topic, &rec.Payload, &rec.Timestamp); err != nil {
			continue
		}
		if mqttutil.HasWildcard(topic) && !mqttutil.TopicMatches(topic, rec.Topic) {
			continue
		}
		records = append(records, rec)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(records)
}
