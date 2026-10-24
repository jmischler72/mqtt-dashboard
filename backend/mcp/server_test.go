package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/cron"
	"mqtt-dashboard/db"
	"mqtt-dashboard/logic"
	"mqtt-dashboard/models"
)

type mockRegistry struct {
	defaultID string
	published []struct {
		brokerID string
		topic    string
		payload  string
	}
}

func (m *mockRegistry) AddBroker(models.MQTTBroker) error { return nil }
func (m *mockRegistry) RemoveBroker(string)               {}
func (m *mockRegistry) SetDefault(id string)              { m.defaultID = id }
func (m *mockRegistry) DefaultBrokerID() string           { return m.defaultID }
func (m *mockRegistry) Status(string) string              { return "connected" }
func (m *mockRegistry) StatusError(string) string         { return "" }
func (m *mockRegistry) GetStats(string) *models.BrokerStats {
	return nil
}
func (m *mockRegistry) Publish(brokerID, topic string, _ byte, _ bool, payload []byte, _ ...string) error {
	m.published = append(m.published, struct {
		brokerID string
		topic    string
		payload  string
	}{brokerID, topic, string(payload)})
	return nil
}

type mockScheduler struct {
	added   map[string]string
	removed []string
}

func (m *mockScheduler) AddJob(panelID, _, cronExpr, _, _ string, _ byte, _, _ bool) error {
	if m.added == nil {
		m.added = make(map[string]string)
	}
	m.added[panelID] = cronExpr
	return nil
}
func (m *mockScheduler) RemoveJob(panelID string) {
	m.removed = append(m.removed, panelID)
}
func (m *mockScheduler) ToggleJob(string, bool) error          { return nil }
func (m *mockScheduler) GetJob(string) (*cron.JobInfo, bool)   { return nil, false }
func (m *mockScheduler) GetJobs() []*cron.JobInfo              { return nil }

type mockLogic struct {
	rules   map[string]*logic.Rule
	removed []string
}

func (m *mockLogic) AddRule(r *logic.Rule) error {
	if m.rules == nil {
		m.rules = make(map[string]*logic.Rule)
	}
	m.rules[r.PanelID] = r
	return nil
}
func (m *mockLogic) RemoveRule(panelID string) {
	m.removed = append(m.removed, panelID)
}
func (m *mockLogic) ToggleRule(string, bool) error               { return nil }
func (m *mockLogic) GetRule(string) (*logic.Rule, bool)          { return nil, false }
func (m *mockLogic) GetStatus(string) (*logic.RuleStatus, bool)  { return nil, false }
func (m *mockLogic) PrimeCache(_, _, _ string)                   {}

func setupTestServer(t *testing.T) (*Server, *mockRegistry, *mockScheduler, *mockLogic) {
	t.Helper()
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	// Seed a broker and some MQTT history
	_, err = database.Exec(`
		INSERT INTO mqtt_brokers (id, name, host, port, client_id, is_enabled, sort_order)
		VALUES ('broker-1', 'Local Mosquitto', 'localhost', 1883, 'test-client', 1, 0)
	`)
	if err != nil {
		t.Fatalf("seed broker: %v", err)
	}

	_, err = database.Exec(`
		INSERT INTO mqtt_history (broker_id, topic, payload, qos, retained)
		VALUES
			('broker-1', 'sensors/greenhouse/temp', '{"temperature": 23.5, "unit": "C"}', 0, 0),
			('broker-1', 'sensors/greenhouse/humidity', '{"humidity": 65}', 0, 1),
			('broker-1', 'actuators/fan/state', 'ON', 1, 1)
	`)
	if err != nil {
		t.Fatalf("seed history: %v", err)
	}

	reg := &mockRegistry{defaultID: "broker-1"}
	sched := &mockScheduler{}
	logicEng := &mockLogic{}

	srv := NewServer(database, reg, sched, logicEng, nil, "1.0.0-test", "/")
	return srv, reg, sched, logicEng
}

func postJSONRPC(t *testing.T, handler http.Handler, method string, params any) jsonRPCResponse {
	t.Helper()
	bodyMap := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
	}
	if params != nil {
		bodyMap["params"] = params
	}
	b, _ := json.Marshal(bodyMap)
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /mcp (%s) status = %d, body = %s", method, rec.Code, rec.Body.String())
	}
	var resp jsonRPCResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v (body: %s)", err, rec.Body.String())
	}
	return resp
}

func callToolHelper(t *testing.T, r chi.Router, toolName string, args map[string]any) (string, bool) {
	t.Helper()
	resp := postJSONRPC(t, r, "tools/call", map[string]any{
		"name":      toolName,
		"arguments": args,
	})
	if resp.Error != nil {
		t.Fatalf("tool %s returned RPC error: %+v", toolName, resp.Error)
	}
	raw, _ := json.Marshal(resp.Result)
	var toolRes struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(raw, &toolRes); err != nil {
		t.Fatalf("unmarshal tool result: %v", err)
	}
	if len(toolRes.Content) == 0 {
		t.Fatalf("empty content from tool %s", toolName)
	}
	return toolRes.Content[0].Text, toolRes.IsError
}

func TestMCPHandshakeAndDiscovery(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// 1. initialize
	initResp := postJSONRPC(t, r, "initialize", map[string]any{
		"protocolVersion": "2025-03-26",
	})
	if initResp.Error != nil {
		t.Fatalf("initialize error: %+v", initResp.Error)
	}
	resMap, _ := initResp.Result.(map[string]any)
	if resMap["protocolVersion"] != "2025-03-26" {
		t.Errorf("protocolVersion = %v, want 2025-03-26", resMap["protocolVersion"])
	}

	// 2. notifications/initialized (no id -> 202 Accepted)
	notifBytes := []byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(notifBytes))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Errorf("notification status = %d, want 202", rec.Code)
	}

	// 3. ping
	pingResp := postJSONRPC(t, r, "ping", nil)
	if pingResp.Error != nil {
		t.Fatalf("ping error: %+v", pingResp.Error)
	}

	// 4. tools/list
	toolsResp := postJSONRPC(t, r, "tools/list", nil)
	rawTools, _ := json.Marshal(toolsResp.Result)
	if !strings.Contains(string(rawTools), "create_dashboard") || !strings.Contains(string(rawTools), "explore_topics") {
		t.Errorf("tools/list missing expected tools: %s", string(rawTools))
	}

	// 5. resources/list & resources/read
	resList := postJSONRPC(t, r, "resources/list", nil)
	if resList.Error != nil {
		t.Fatalf("resources/list error: %+v", resList.Error)
	}
	resRead := postJSONRPC(t, r, "resources/read", map[string]any{
		"uri": "mqtt-dashboard://schema/panels",
	})
	if resRead.Error != nil {
		t.Fatalf("resources/read error: %+v", resRead.Error)
	}

	// 6. prompts/list & prompts/get
	pList := postJSONRPC(t, r, "prompts/list", nil)
	if pList.Error != nil {
		t.Fatalf("prompts/list error: %+v", pList.Error)
	}
	pGet := postJSONRPC(t, r, "prompts/get", map[string]any{
		"name":      "design_dashboard",
		"arguments": map[string]string{"project": "Smart Greenhouse"},
	})
	if pGet.Error != nil {
		t.Fatalf("prompts/get error: %+v", pGet.Error)
	}
}

func TestMCPToolsEndToEnd(t *testing.T) {
	srv, reg, sched, logicEng := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// 1. list_brokers
	brokersTxt, isErr := callToolHelper(t, r, "list_brokers", nil)
	if isErr || !strings.Contains(brokersTxt, "Local Mosquitto") {
		t.Fatalf("list_brokers unexpected output: %s", brokersTxt)
	}

	// 2. explore_topics with wildcard filter
	topicsTxt, isErr := callToolHelper(t, r, "explore_topics", map[string]any{
		"filter": "sensors/#",
	})
	if isErr || !strings.Contains(topicsTxt, "sensors/greenhouse/temp") || strings.Contains(topicsTxt, "actuators/fan/state") {
		t.Fatalf("explore_topics unexpected output: %s", topicsTxt)
	}

	// 3. sample_topic_payload
	sampleTxt, isErr := callToolHelper(t, r, "sample_topic_payload", map[string]any{
		"topic": "sensors/greenhouse/temp",
	})
	if isErr || !strings.Contains(sampleTxt, "23.5") {
		t.Fatalf("sample_topic_payload unexpected output: %s", sampleTxt)
	}

	// 4. get_panel_schema
	schemaTxt, isErr := callToolHelper(t, r, "get_panel_schema", map[string]any{
		"panel_type": "gauge",
	})
	if isErr || !strings.Contains(schemaTxt, "readTemplate") {
		t.Fatalf("get_panel_schema unexpected output: %s", schemaTxt)
	}

	// 5. create_dashboard (with auto-layout when coordinates are omitted, plus cron and logic panels)
	createTxt, isErr := callToolHelper(t, r, "create_dashboard", map[string]any{
		"name": "Greenhouse AI Dashboard",
		"panels": []map[string]any{
			{
				"title":      "Header",
				"panel_type": "text",
				"config_json": map[string]any{
					"markdown": "# Greenhouse",
				},
			},
			{
				"title":      "Temperature",
				"panel_type": "gauge",
				"config_json": map[string]any{
					"topic":        "sensors/greenhouse/temp",
					"readTemplate": `{"temperature": {value}}`,
					"unit":         "°C",
				},
			},
			{
				"title":      "Poll Sensors",
				"panel_type": "cron",
				"config_json": map[string]any{
					"cron_expr": "*/5 * * * *",
					"topic":     "sensors/poll",
					"payload":   "POLL",
					"enabled":   true,
				},
			},
			{
				"title":      "Overheat Fan Rule",
				"panel_type": "logic",
				"config_json": map[string]any{
					"source_topic": "sensors/greenhouse/temp",
					"target_topic": "actuators/fan/set",
					"payload":      "ON",
					"enabled":      true,
				},
			},
		},
	})
	if isErr {
		t.Fatalf("create_dashboard failed: %s", createTxt)
	}

	var created struct {
		DashboardID string                        `json:"dashboard_id"`
		PanelCount  int                           `json:"panel_count"`
		ExportJSON  models.DashboardImportPayload `json:"export_json"`
	}
	if err := json.Unmarshal([]byte(createTxt), &created); err != nil {
		t.Fatalf("unmarshal create_dashboard response: %v", err)
	}
	if created.DashboardID == "" || created.PanelCount != 4 {
		t.Fatalf("unexpected created dashboard: %+v", created)
	}
	if len(sched.added) != 1 {
		t.Errorf("expected 1 cron job registered, got %d", len(sched.added))
	}
	if len(logicEng.rules) != 1 {
		t.Errorf("expected 1 logic rule registered, got %d", len(logicEng.rules))
	}
	// Verify auto-layout assigned non-overlapping positions
	if created.ExportJSON.Panels[1].X == 0 && created.ExportJSON.Panels[1].Y == 0 {
		t.Errorf("expected auto-layout to place second panel at non-(0,0), got (%d,%d)", created.ExportJSON.Panels[1].X, created.ExportJSON.Panels[1].Y)
	}

	// 6. get_dashboard by name
	getTxt, isErr := callToolHelper(t, r, "get_dashboard", map[string]any{
		"name": "greenhouse ai dashboard",
	})
	if isErr || !strings.Contains(getTxt, created.DashboardID) {
		t.Fatalf("get_dashboard failed: %s", getTxt)
	}

	// 7. update_dashboard (append mode)
	updTxt, isErr := callToolHelper(t, r, "update_dashboard", map[string]any{
		"dashboard_id": created.DashboardID,
		"mode":         "append",
		"panels": []map[string]any{
			{
				"title":      "Temperature Trend",
				"panel_type": "graph",
				"config_json": map[string]any{
					"topics": "sensors/greenhouse/temp",
				},
			},
		},
	})
	if isErr || !strings.Contains(updTxt, `"total_panels": 5`) {
		t.Fatalf("update_dashboard append failed: %s", updTxt)
	}

	// 8. publish_message
	pubTxt, isErr := callToolHelper(t, r, "publish_message", map[string]any{
		"topic":   "actuators/fan/set",
		"payload": "ON",
	})
	if isErr || len(reg.published) != 1 || reg.published[0].topic != "actuators/fan/set" {
		t.Fatalf("publish_message failed: %s", pubTxt)
	}

	// 9. delete_dashboard
	delTxt, isErr := callToolHelper(t, r, "delete_dashboard", map[string]any{
		"dashboard_id": created.DashboardID,
	})
	if isErr || !strings.Contains(delTxt, `"deleted": true`) {
		t.Fatalf("delete_dashboard failed: %s", delTxt)
	}
}

func TestMCPSSEAndStdioTransports(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// Test Stdio transport
	inBuf := bytes.NewBufferString(`{"jsonrpc":"2.0","id":42,"method":"ping"}` + "\n")
	var outBuf bytes.Buffer
	if err := srv.ServeStdio(context.Background(), inBuf, &outBuf); err != nil {
		t.Fatalf("ServeStdio: %v", err)
	}
	if !strings.Contains(outBuf.String(), `"id":42`) {
		t.Fatalf("ServeStdio output = %s", outBuf.String())
	}

	// Test SSE transport in-memory with httptest.ResponseRecorder
	ctx, cancel := context.WithCancel(context.Background())
	sseRec := httptest.NewRecorder()
	sseReq := httptest.NewRequest(http.MethodGet, "/mcp/sse", nil).WithContext(ctx)

	done := make(chan struct{})
	go func() {
		defer close(done)
		r.ServeHTTP(sseRec, sseReq)
	}()

	// Wait briefly for the SSE session to register
	var sessionID string
	for i := 0; i < 50; i++ {
		srv.mu.RLock()
		for id := range srv.sessions {
			sessionID = id
		}
		srv.mu.RUnlock()
		if sessionID != "" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if sessionID == "" {
		cancel()
		t.Fatal("SSE session was not registered")
	}

	// Post a ping to /mcp/messages?sessionId=<sessionID>
	msgReq := httptest.NewRequest(http.MethodPost, "/mcp/messages?sessionId="+sessionID, strings.NewReader(`{"jsonrpc":"2.0","id":99,"method":"ping"}`))
	msgReq.Header.Set("Content-Type", "application/json")
	msgRec := httptest.NewRecorder()
	r.ServeHTTP(msgRec, msgReq)

	if msgRec.Code != http.StatusAccepted {
		cancel()
		t.Fatalf("POST /mcp/messages status = %d, want 202", msgRec.Code)
	}

	time.Sleep(10 * time.Millisecond)
	cancel()
	<-done

	sseOut := sseRec.Body.String()
	if !strings.Contains(sseOut, "event: endpoint") || !strings.Contains(sseOut, "event: message") || !strings.Contains(sseOut, `"id":99`) {
		t.Fatalf("unexpected SSE stream output: %s", sseOut)
	}
}
