package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mqtt-dashboard/models"
	mqttutil "mqtt-dashboard/mqtt"
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
		prefixTopic := strings.TrimSuffix(topic, "/#")
		if prefixTopic == topic {
			prefixTopic = ""
		}
		rows, err = h.db.Query(
			`SELECT id, broker_id, topic, COALESCE(payload, ''), timestamp, qos, retained FROM mqtt_history
			 WHERE broker_id = ? AND (topic = ? OR topic LIKE ?) AND timestamp > DATETIME('now', '-' || ? || ' hours')
			 ORDER BY timestamp ASC`,
			brokerID, prefixTopic, likePattern, retentionHours,
		)
	} else {
		rows, err = h.db.Query(
			`SELECT id, broker_id, topic, COALESCE(payload, ''), timestamp, qos, retained FROM mqtt_history
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
		if err := rows.Scan(&rec.ID, &rec.BrokerID, &rec.Topic, &rec.Payload, &rec.Timestamp, &rec.QoS, &rec.Retained); err != nil {
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

type activityBucket struct {
	TS    int64 `json:"ts"`    // bucket start, unix seconds
	Count int64 `json:"count"` // messages in the bucket
	Bytes int64 `json:"bytes"` // payload bytes in the bucket
}

type activityTopic struct {
	Topic    string `json:"topic"`
	Count    int64  `json:"count"`
	LastSeen string `json:"last_seen"`
}

type activityResponse struct {
	BucketSeconds int64            `json:"bucket_seconds"`
	Buckets       []activityBucket `json:"buckets"`
	Total         int64            `json:"total"`
	TotalBytes    int64            `json:"total_bytes"`
	Topics        []activityTopic  `json:"topics"`
}

var allowedRanges = map[int]bool{60: true, 300: true, 900: true, 3600: true}

// topicScope builds a SQL WHERE fragment (and its args) restricting mqtt_history
// to the topics matching an MQTT filter. It avoids enumerating rows in the
// common cases; only mid-level '+' wildcards require resolving the concrete
// topic set first. ok=false means the filter matches nothing.
func (h *ExplorerHandler) singleTopicScope(brokerID, topic string) (clause string, args []any, ok bool) {
	if !mqttutil.HasWildcard(topic) {
		return "topic = ?", []any{topic}, true
	}
	if topic == "#" {
		// Per MQTT spec, bare '#' excludes reserved '$' topics.
		return "topic NOT LIKE '$%'", nil, true
	}
	if strings.HasSuffix(topic, "/#") && !strings.Contains(topic, "+") {
		prefix := strings.TrimSuffix(topic, "/#")
		return "(topic = ? OR topic LIKE ?)", []any{prefix, prefix + "/%"}, true
	}

	// '+' wildcard (or bare '+'): resolve the exact matching topic set.
	like := mqttutil.ToSQLLikePattern(topic)
	rows, err := h.db.Query(
		`SELECT DISTINCT topic FROM mqtt_history WHERE broker_id = ? AND topic LIKE ?`,
		brokerID, like,
	)
	if err != nil {
		return "", nil, false
	}
	defer rows.Close()
	matched := []any{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			continue
		}
		if mqttutil.TopicMatches(topic, t) {
			matched = append(matched, t)
		}
	}
	if len(matched) == 0 {
		return "", nil, false
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(matched)), ",")
	return "topic IN (" + placeholders + ")", matched, true
}

func (h *ExplorerHandler) topicScope(brokerID, topicStr string) (clause string, args []any, ok bool) {
	rawList := strings.Split(topicStr, ",")
	var clauses []string
	var allArgs []any

	for _, raw := range rawList {
		t := strings.TrimSpace(raw)
		if t == "" {
			continue
		}
		c, a, matches := h.singleTopicScope(brokerID, t)
		if matches {
			clauses = append(clauses, c)
			allArgs = append(allArgs, a...)
		}
	}

	if len(clauses) == 0 {
		return "", nil, false
	}
	if len(clauses) == 1 {
		return clauses[0], allArgs, true
	}
	return "(" + strings.Join(clauses, " OR ") + ")", allArgs, true
}

// GetActivity returns time-bucketed message activity for a broker + topic filter
// over a recent range, plus a per-topic breakdown. Aggregation happens in SQL so
// the response size is bounded by the bucket count, not the message volume.
func (h *ExplorerHandler) GetActivity(w http.ResponseWriter, r *http.Request) {
	brokerID := r.URL.Query().Get("broker_id")
	topic := r.URL.Query().Get("topic")
	if brokerID == "" {
		http.Error(w, "broker_id required", http.StatusBadRequest)
		return
	}
	if topic == "" {
		topic = "#"
	}

	rangeSeconds, _ := strconv.Atoi(r.URL.Query().Get("range_seconds"))
	if !allowedRanges[rangeSeconds] {
		rangeSeconds = 60
	}
	buckets, _ := strconv.Atoi(r.URL.Query().Get("buckets"))
	if buckets < 10 || buckets > 120 {
		buckets = 60
	}
	bucketSize := rangeSeconds / buckets
	if bucketSize < 1 {
		bucketSize = 1
	}

	nowBucket := time.Now().Unix() / int64(bucketSize)
	startBucket := nowBucket - int64(buckets-1)
	cutoffUnix := startBucket * int64(bucketSize)

	resp := activityResponse{
		BucketSeconds: int64(bucketSize),
		Buckets:       make([]activityBucket, buckets),
		Topics:        []activityTopic{},
	}
	// Pre-fill a dense, zeroed bucket series (oldest -> newest).
	for i := 0; i < buckets; i++ {
		b := startBucket + int64(i)
		resp.Buckets[i] = activityBucket{TS: b * int64(bucketSize)}
	}

	scope, scopeArgs, ok := h.topicScope(brokerID, topic)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	bucketArgs := append([]any{int64(bucketSize), brokerID}, scopeArgs...)
	bucketArgs = append(bucketArgs, cutoffUnix)
	rows, err := h.db.Query(
		`SELECT CAST(strftime('%s', timestamp) AS INTEGER)/? AS b,
		        COUNT(*), COALESCE(SUM(LENGTH(COALESCE(payload, ''))), 0)
		 FROM mqtt_history
		 WHERE broker_id = ? AND `+scope+`
		       AND CAST(strftime('%s', timestamp) AS INTEGER) >= ?
		 GROUP BY b ORDER BY b`,
		bucketArgs...,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var b, count, bytes int64
		if err := rows.Scan(&b, &count, &bytes); err != nil {
			continue
		}
		idx := int(b - startBucket)
		if idx < 0 || idx >= buckets {
			continue
		}
		resp.Buckets[idx].Count = count
		resp.Buckets[idx].Bytes = bytes
		resp.Total += count
		resp.TotalBytes += bytes
	}

	topicArgs := append([]any{brokerID}, scopeArgs...)
	topicArgs = append(topicArgs, cutoffUnix)
	trows, err := h.db.Query(
		`SELECT topic, COUNT(*), MAX(timestamp) FROM mqtt_history
		 WHERE broker_id = ? AND `+scope+`
		       AND CAST(strftime('%s', timestamp) AS INTEGER) >= ?
		 GROUP BY topic ORDER BY COUNT(*) DESC LIMIT 50`,
		topicArgs...,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer trows.Close()
	for trows.Next() {
		var t activityTopic
		if err := trows.Scan(&t.Topic, &t.Count, &t.LastSeen); err != nil {
			continue
		}
		resp.Topics = append(resp.Topics, t)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
