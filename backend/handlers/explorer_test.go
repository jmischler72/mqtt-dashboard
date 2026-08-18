package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
)

func newExplorerRouter(h *handlers.ExplorerHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/explorer/tree", h.GetTree)
	r.Get("/api/explorer/history", h.GetHistory)
	r.Get("/api/explorer/activity", h.GetActivity)
	return r
}

func TestGetTree_MissingBrokerID(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewExplorerHandler(db)
	r := newExplorerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/tree", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetTree_Empty(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewExplorerHandler(db)
	r := newExplorerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/tree?broker_id=broker1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var topics []string
	decodeJSON(t, rec.Body, &topics)
	if len(topics) != 0 {
		t.Errorf("expected empty topics, got %v", topics)
	}
}

func TestGetTree_WithHistory(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/humidity', '60')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '26')`) // duplicate

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/tree?broker_id=b1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var topics []string
	decodeJSON(t, rec.Body, &topics)
	if len(topics) != 2 {
		t.Errorf("expected 2 distinct topics, got %d: %v", len(topics), topics)
	}
}

func TestGetHistory_MissingParams(t *testing.T) {
	db := setupTestDB(t)
	h := handlers.NewExplorerHandler(db)
	r := newExplorerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetHistory_WithRecords(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensor/temp', '30')`)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=sensor/temp", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 2 {
		t.Errorf("expected 2 records, got %d", len(records))
	}
}

func TestGetHistory_FiltersByBroker(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'a/b', 'x')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b2', 'a/b', 'y')`)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=a/b", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 1 {
		t.Errorf("expected 1 record for b1, got %d", len(records))
	}
}

func TestGetHistory_WildcardHash(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/humidity', '60')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/deep/nested', '1')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'other/topic', 'x')`)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=sensors%2F%23", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 3 {
		t.Errorf("expected 3 records for sensors/#, got %d", len(records))
	}
}

func TestGetHistory_WildcardHash_MatchesParentTopic(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'test', 'root')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'test/child', 'leaf')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'other', 'nope')`)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=test%2F%23", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 2 {
		t.Errorf("expected 2 records for test/# (including parent topic), got %d", len(records))
	}
}

func TestGetHistory_WildcardHash_ReportedScenarioIncludesParent(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'test/tetsgisf', 'payload')`)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=test%2Ftetsgisf%2F%23", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 1 {
		t.Errorf("expected 1 record for test/tetsgisf/# with parent topic payload, got %d", len(records))
	}
}

func TestGetHistory_WildcardPlus(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/living/status', 'on')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/kitchen/status', 'off')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/living/room/status', 'on')`) // should not match
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/status', 'x')`)              // should not match

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/history?broker_id=b1&topic=home%2F%2B%2Fstatus", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var records []map[string]any
	decodeJSON(t, rec.Body, &records)
	if len(records) != 2 {
		t.Errorf("expected 2 records for home/+/status, got %d", len(records))
	}
}

type activityResp struct {
	BucketSeconds int64 `json:"bucket_seconds"`
	Buckets       []struct {
		TS    int64 `json:"ts"`
		Count int64 `json:"count"`
		Bytes int64 `json:"bytes"`
	} `json:"buckets"`
	Total      int64 `json:"total"`
	TotalBytes int64 `json:"total_bytes"`
	Topics     []struct {
		Topic    string `json:"topic"`
		Count    int64  `json:"count"`
		LastSeen string `json:"last_seen"`
	} `json:"topics"`
}

func getActivity(t *testing.T, r http.Handler, query string) activityResp {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/explorer/activity?"+query, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp activityResp
	decodeJSON(t, rec.Body, &resp)
	return resp
}

func TestGetActivity_MissingBrokerID(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/explorer/activity", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestGetActivity_TotalsAndBuckets(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/temp', '30')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/humidity', '60')`)

	resp := getActivity(t, r, "broker_id=b1&range_seconds=60&buckets=60")

	if len(resp.Buckets) != 60 {
		t.Errorf("expected 60 dense buckets, got %d", len(resp.Buckets))
	}
	if resp.BucketSeconds != 1 {
		t.Errorf("expected bucket_seconds=1 for 60s/60, got %d", resp.BucketSeconds)
	}
	if resp.Total != 3 {
		t.Errorf("expected total=3, got %d", resp.Total)
	}
	if resp.TotalBytes != 6 { // "25"+"30"+"60" = 6 bytes
		t.Errorf("expected total_bytes=6, got %d", resp.TotalBytes)
	}
	if len(resp.Topics) != 2 {
		t.Errorf("expected 2 topics, got %d", len(resp.Topics))
	}
	// Just-inserted rows land in the most recent bucket.
	if resp.Buckets[len(resp.Buckets)-1].Count != 3 {
		t.Errorf("expected 3 messages in the last bucket, got %d", resp.Buckets[len(resp.Buckets)-1].Count)
	}
}

func TestGetActivity_ExcludesSysForHash(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', '$SYS/broker/uptime', '100')`)

	resp := getActivity(t, r, "broker_id=b1&topic=%23&range_seconds=60")

	if resp.Total != 1 {
		t.Errorf("bare # should exclude $SYS: expected total=1, got %d", resp.Total)
	}
	for _, tp := range resp.Topics {
		if tp.Topic == "$SYS/broker/uptime" {
			t.Errorf("bare # should not include $SYS topic")
		}
	}
}

func TestGetActivity_WildcardPlus(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/living/status', 'on')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/kitchen/status', 'off')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/living/room/status', 'on')`) // no match
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/status', 'x')`)              // no match

	resp := getActivity(t, r, "broker_id=b1&topic=home%2F%2B%2Fstatus&range_seconds=60")

	if resp.Total != 2 {
		t.Errorf("expected total=2 for home/+/status, got %d", resp.Total)
	}
	if len(resp.Topics) != 2 {
		t.Errorf("expected 2 topics for home/+/status, got %d", len(resp.Topics))
	}
}

func TestGetActivity_EmptyMatch(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/temp', '25')`)

	resp := getActivity(t, r, "broker_id=b1&topic=nope%2F%2B%2Fhere&range_seconds=60")

	if resp.Total != 0 {
		t.Errorf("expected total=0 for non-matching filter, got %d", resp.Total)
	}
	if len(resp.Topics) != 0 {
		t.Errorf("expected 0 topics, got %d", len(resp.Topics))
	}
	if len(resp.Buckets) != 60 {
		t.Errorf("expected dense buckets even when empty, got %d", len(resp.Buckets))
	}
}

func TestGetActivity_MultipleTopics(t *testing.T) {
	database := setupTestDB(t)
	h := handlers.NewExplorerHandler(database)
	r := newExplorerRouter(h)

	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'sensors/temp', '25')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'home/living/light', 'on')`)
	database.Exec(`INSERT INTO mqtt_history (broker_id, topic, payload) VALUES ('b1', 'other/topic', 'skip')`)

	resp := getActivity(t, r, "broker_id=b1&topic=sensors%2Ftemp%2C%20home%2Fliving%2Flight&range_seconds=60")

	if resp.Total != 2 {
		t.Errorf("expected total=2 for multi-topic query, got %d", resp.Total)
	}
	if len(resp.Topics) != 2 {
		t.Errorf("expected 2 topics for multi-topic query, got %d", len(resp.Topics))
	}
}
