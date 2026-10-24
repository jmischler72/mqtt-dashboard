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

func TestMCPDefaultPanelSize(t *testing.T) {
	types := []string{
		"gauge", "toggle", "slider", "button",
		"broker_stats", "input",
		"stats",
		"graph", "log",
		"separator",
		"image",
		"text",
		"logic",
		"unknown_custom_type",
	}
	for _, pt := range types {
		w, h := DefaultPanelSize(pt, nil)
		if w <= 0 || h <= 0 {
			t.Fatalf("DefaultPanelSize(%q) = (%d, %d), expected positive", pt, w, h)
		}
	}
}

func TestMCPStreamableHTTP_GET_DELETE(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// 1. GET /mcp returns 200 with server status
	getReq := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK || !strings.Contains(getRec.Body.String(), `"name":"mqtt-dashboard"`) {
		t.Fatalf("GET /mcp status = %d, body = %s", getRec.Code, getRec.Body.String())
	}

	// 2. DELETE /mcp without Mcp-Session-Id returns 200
	delReqNoHeader := httptest.NewRequest(http.MethodDelete, "/mcp", nil)
	delRecNoHeader := httptest.NewRecorder()
	r.ServeHTTP(delRecNoHeader, delReqNoHeader)
	if delRecNoHeader.Code != http.StatusOK {
		t.Fatalf("DELETE /mcp without header status = %d, want 200", delRecNoHeader.Code)
	}

	// 3. DELETE /mcp with Mcp-Session-Id returns 200
	delReq := httptest.NewRequest(http.MethodDelete, "/mcp", nil)
	delReq.Header.Set("Mcp-Session-Id", "test-session-123")
	delRec := httptest.NewRecorder()
	r.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("DELETE /mcp with header status = %d, want 200", delRec.Code)
	}
}

func TestMCPServerEnabledToggle(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	if !srv.IsEnabled() {
		t.Fatal("expected server to be enabled by default")
	}

	srv.SetEnabled(false)
	if srv.IsEnabled() {
		t.Fatal("expected server to be disabled after SetEnabled(false)")
	}

	// Requests while disabled return 404
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("POST /mcp while disabled status = %d, want 404", rec.Code)
	}

	srv.SetEnabled(true)
	if !srv.IsEnabled() {
		t.Fatal("expected server to be enabled after SetEnabled(true)")
	}
}

func TestMCPErrorHandlingAndJSONRPC(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// 1. Invalid JSON body -> -32700 Parse error
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader("not a json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), "-32700") {
		t.Fatalf("expected parse error, got %s", rec.Body.String())
	}

	// 2. Unknown JSON-RPC method -> -32601 Method not found
	req = httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"unknown/method"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), "-32601") {
		t.Fatalf("expected method not found, got %s", rec.Body.String())
	}

	// 3. Notification (no id) is accepted with 202 Accepted
	req = httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("notification status = %d, want 202", rec.Code)
	}

	// 4. tools/call with unknown tool name returns JSON-RPC error
	unknownResp := postJSONRPC(t, r, "tools/call", map[string]any{
		"name": "unknown_tool",
	})
	if unknownResp.Error == nil || !strings.Contains(unknownResp.Error.Message, "Unknown tool") {
		t.Fatalf("expected unknown tool error, got: %+v", unknownResp.Error)
	}

	// 5. list_dashboards tool call
	dashboardsTxt, isErr := callToolHelper(t, r, "list_dashboards", map[string]any{})
	if isErr || !strings.Contains(dashboardsTxt, `"dashboards"`) {
		t.Fatalf("list_dashboards failed: %s", dashboardsTxt)
	}

	// 6. create_dashboard validation errors
	_, isErr = callToolHelper(t, r, "create_dashboard", map[string]any{
		"name": "",
	})
	if !isErr {
		t.Fatal("expected error creating dashboard with empty name")
	}

	_, isErr = callToolHelper(t, r, "create_dashboard", map[string]any{
		"name": "Bad Panel Dashboard",
		"panels": []map[string]any{
			{"panel_type": "invalid_type", "title": "Bad"},
		},
	})
	if !isErr {
		t.Fatal("expected error creating dashboard with invalid panel_type")
	}

	// 7. update_dashboard validation errors and replace mode
	_, isErr = callToolHelper(t, r, "update_dashboard", map[string]any{})
	if !isErr {
		t.Fatal("expected error updating dashboard without dashboard_id")
	}

	_, isErr = callToolHelper(t, r, "update_dashboard", map[string]any{
		"dashboard_id": "non-existent-id",
		"mode":         "append",
		"panels": []map[string]any{
			{"panel_type": "stats", "title": "S"},
		},
	})
	if !isErr {
		t.Fatal("expected error updating non-existent dashboard")
	}

	// Create a dashboard to test update replace mode
	createTxt, isErr := callToolHelper(t, r, "create_dashboard", map[string]any{
		"name": "Replace Test Dashboard",
		"panels": []map[string]any{
			{"panel_type": "stats", "title": "P1"},
		},
	})
	if isErr {
		t.Fatalf("create failed: %s", createTxt)
	}
	var c struct {
		DashboardID string `json:"dashboard_id"`
	}
	json.Unmarshal([]byte(createTxt), &c)

	updTxt, isErr := callToolHelper(t, r, "update_dashboard", map[string]any{
		"dashboard_id": c.DashboardID,
		"mode":         "replace",
		"panels": []map[string]any{
			{"panel_type": "gauge", "title": "New P1"},
			{"panel_type": "slider", "title": "New P2"},
		},
	})
	if isErr || !strings.Contains(updTxt, `"total_panels": 2`) {
		t.Fatalf("update replace mode failed: %s", updTxt)
	}

	// 8. sample_topic_payload validation & options
	_, isErr = callToolHelper(t, r, "sample_topic_payload", map[string]any{
		"topic": "",
	})
	if !isErr {
		t.Fatal("expected error sampling empty topic")
	}

	sampleTxt, isErr := callToolHelper(t, r, "sample_topic_payload", map[string]any{
		"topic":  "sensors/greenhouse/temp",
		"limit":  5,
		"offset": 0,
		"since":  time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
	})
	if isErr || !strings.Contains(sampleTxt, "messages") {
		t.Fatalf("sample_topic_payload with options failed: %s", sampleTxt)
	}

	// 9. publish_message validation & options
	_, isErr = callToolHelper(t, r, "publish_message", map[string]any{
		"topic": "",
	})
	if !isErr {
		t.Fatal("expected error publishing to empty topic")
	}

	pubTxt, isErr := callToolHelper(t, r, "publish_message", map[string]any{
		"broker_id": "broker-1",
		"topic":     "cmd/json",
		"payload":   `{"power": true, "level": 42}`,
		"qos":       1,
		"retain":    true,
	})
	if isErr || !strings.Contains(pubTxt, `"status": "published"`) {
		t.Fatalf("publish_message with object payload failed: %s", pubTxt)
	}

	// 10. get_dashboard validation
	_, isErr = callToolHelper(t, r, "get_dashboard", map[string]any{})
	if !isErr {
		t.Fatal("expected error get_dashboard without id/name")
	}
	_, isErr = callToolHelper(t, r, "get_dashboard", map[string]any{"dashboard_id": "non-existent"})
	if !isErr {
		t.Fatal("expected error get_dashboard for nonexistent id")
	}

	// 11. delete_dashboard validation
	_, isErr = callToolHelper(t, r, "delete_dashboard", map[string]any{})
	if !isErr {
		t.Fatal("expected error delete_dashboard without dashboard_id")
	}
	_, isErr = callToolHelper(t, r, "delete_dashboard", map[string]any{"dashboard_id": "non-existent"})
	if !isErr {
		t.Fatal("expected error delete_dashboard for nonexistent id")
	}
}

func TestMCPDocumentationAndLayout(t *testing.T) {
	doc, err := BuildSchemaDocumentation("")
	if err != nil || !strings.Contains(doc, "panel_types") || !strings.Contains(doc, "{value}") {
		t.Fatalf("unexpected BuildSchemaDocumentation: err=%v doc=%s", err, doc)
	}

	// Also test filtering by specific panel type
	filteredDoc, err := BuildSchemaDocumentation("gauge")
	if err != nil || !strings.Contains(filteredDoc, `"type": "gauge"`) {
		t.Fatalf("unexpected BuildSchemaDocumentation(gauge): %v", err)
	}

	if _, err := BuildSchemaDocumentation("invalid_filter"); err == nil {
		t.Fatal("expected error for invalid filterType in BuildSchemaDocumentation")
	}

	// Test separator orientation
	w, h := DefaultPanelSize("separator", []byte(`{"orientation":"vertical"}`))
	if w != 1 || h != 4 {
		t.Fatalf("expected vertical separator (1, 4), got (%d, %d)", w, h)
	}

	// Test empty panels
	emptyRes, err := NormalizeAndLayoutPanels(nil, false)
	if err != nil || len(emptyRes) != 0 {
		t.Fatalf("expected empty result for nil panels, got %+v", emptyRes)
	}

	// Test empty panel_type
	_, err = NormalizeAndLayoutPanels([]models.ImportPanel{{PanelType: ""}}, true)
	if err == nil {
		t.Fatal("expected error for empty panel_type")
	}

	// Test clamping when autoLayout = false
	clampedPanels := []models.ImportPanel{
		{
			PanelType: "gauge",
			Title:     "Clamped",
			X:         -2,
			Y:         -3,
			W:         20,
			H:         0,
		},
		{
			PanelType: "button",
			Title:     "Clamped Right",
			X:         10,
			Y:         5,
			W:         4,
			H:         2,
		},
	}
	clampedRes, err := NormalizeAndLayoutPanels(clampedPanels, false)
	if err != nil {
		t.Fatalf("NormalizeAndLayoutPanels clamping failed: %v", err)
	}
	if clampedRes[0].X != 0 || clampedRes[0].Y != 0 || clampedRes[0].W != 12 {
		t.Fatalf("expected clamped bounds (X=0, Y=0, W=12), got (%d, %d, %d)", clampedRes[0].X, clampedRes[0].Y, clampedRes[0].W)
	}
	if clampedRes[1].X != 8 {
		t.Fatalf("expected X clamped to 8, got %d", clampedRes[1].X)
	}

	// Test NormalizeAndLayoutPanels with explicit positions and custom types
	panels := []models.ImportPanel{
		{
			PanelType: "stats",
			Title:     "Explicit Stat",
			X:         0,
			Y:         0,
			W:         4,
			H:         2,
		},
		{
			PanelType: "invalid_type",
			Title:     "Invalid Type",
		},
	}
	_, err = NormalizeAndLayoutPanels(panels, true)
	if err == nil {
		t.Fatal("expected error for invalid_type")
	}

	panels[1].PanelType = "gauge"
	res, err := NormalizeAndLayoutPanels(panels, true)
	if err != nil {
		t.Fatalf("NormalizeAndLayoutPanels: %v", err)
	}
	if len(res) != 2 || res[0].W != 4 || res[0].H != 2 {
		t.Fatalf("unexpected normalized panels: %+v", res)
	}
}

func TestMCPResolveDefaultBrokerID_NoBrokers(t *testing.T) {
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	defer database.Close()

	srv := NewServer(database, &mockRegistry{}, &mockScheduler{}, &mockLogic{}, nil, "1.0.0-test", "/")
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// With no brokers in DB, toolListBrokers should return empty list
	txt, isErr := callToolHelper(t, r, "list_brokers", map[string]any{})
	if isErr || !strings.Contains(txt, `"brokers": []`) {
		t.Fatalf("expected empty brokers list, got: %s", txt)
	}

	// With no brokers in DB, publish without broker_id should return an error
	_, isErr = callToolHelper(t, r, "publish_message", map[string]any{
		"topic":   "test/no_brokers",
		"payload": "hello",
	})
	if !isErr {
		t.Fatal("expected error publishing when no default broker exists")
	}
}

func TestMCPBatchAndSSEDirectMessages(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// 1. Empty body to POST /mcp -> 400
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader("   "))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty body status = %d, want 400", rec.Code)
	}

	// 2. Batch JSON-RPC array with 2 pings
	batchReq := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"ping"}]`))
	batchReq.Header.Set("Content-Type", "application/json")
	batchRec := httptest.NewRecorder()
	r.ServeHTTP(batchRec, batchReq)
	if batchRec.Code != http.StatusOK || !strings.Contains(batchRec.Body.String(), `"id":1`) || !strings.Contains(batchRec.Body.String(), `"id":2`) {
		t.Fatalf("batch response failed: %s", batchRec.Body.String())
	}

	// 3. Batch with only notifications -> 202 Accepted
	batchNotifReq := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`[{"jsonrpc":"2.0","method":"notifications/initialized"}]`))
	batchNotifReq.Header.Set("Content-Type", "application/json")
	batchNotifRec := httptest.NewRecorder()
	r.ServeHTTP(batchNotifRec, batchNotifReq)
	if batchNotifRec.Code != http.StatusAccepted {
		t.Fatalf("batch notifications status = %d, want 202", batchNotifRec.Code)
	}

	// 4. Invalid batch format -> 400
	badBatchReq := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`[not-valid-json]`))
	badBatchReq.Header.Set("Content-Type", "application/json")
	badBatchRec := httptest.NewRecorder()
	r.ServeHTTP(badBatchRec, badBatchReq)
	if badBatchRec.Code != http.StatusBadRequest {
		t.Fatalf("bad batch status = %d, want 400", badBatchRec.Code)
	}

	// 5. GET /mcp with text/event-stream initiates SSE stream
	ctx, cancel := context.WithCancel(context.Background())
	sseReq := httptest.NewRequest(http.MethodGet, "/mcp", nil).WithContext(ctx)
	sseReq.Header.Set("Accept", "text/event-stream")
	sseRec := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.ServeHTTP(sseRec, sseReq)
	}()
	time.Sleep(10 * time.Millisecond)
	cancel()
	<-done
	if !strings.Contains(sseRec.Body.String(), "event: endpoint") {
		t.Fatalf("GET /mcp with Accept: text/event-stream did not trigger SSE: %s", sseRec.Body.String())
	}

	// 6. POST /mcp/messages without active SSE session returns JSON directly
	msgDirectReq := httptest.NewRequest(http.MethodPost, "/mcp/messages", strings.NewReader(`{"jsonrpc":"2.0","id":101,"method":"ping"}`))
	msgDirectReq.Header.Set("Mcp-Session-Id", "no-sse-session")
	msgDirectRec := httptest.NewRecorder()
	r.ServeHTTP(msgDirectRec, msgDirectReq)
	if msgDirectRec.Code != http.StatusOK || !strings.Contains(msgDirectRec.Body.String(), `"id":101`) {
		t.Fatalf("direct /mcp/messages response failed: %s", msgDirectRec.Body.String())
	}

	// 7. POST /mcp/messages invalid JSON
	badMsgReq := httptest.NewRequest(http.MethodPost, "/mcp/messages", strings.NewReader(`{invalid}`))
	badMsgRec := httptest.NewRecorder()
	r.ServeHTTP(badMsgRec, badMsgReq)
	if badMsgRec.Code != http.StatusBadRequest {
		t.Fatalf("bad message body status = %d, want 400", badMsgRec.Code)
	}

	// 8. explore_topics with filter query and broker_id
	expTxt, isErr := callToolHelper(t, r, "explore_topics", map[string]any{
		"broker_id": "broker-1",
		"query":     "temp",
		"filter":    "sensors/+/temp",
	})
	if isErr || !strings.Contains(expTxt, "sensors/greenhouse/temp") {
		t.Fatalf("explore_topics with query failed: %s", expTxt)
	}

	// 8b. sample_topic_payload with wildcard
	sampleWild, isErr := callToolHelper(t, r, "sample_topic_payload", map[string]any{
		"topic": "sensors/#",
		"limit": 10,
	})
	if isErr || !strings.Contains(sampleWild, "sensors/greenhouse/temp") {
		t.Fatalf("sample_topic_payload with wildcard failed: %s", sampleWild)
	}

	// 8c. publish_message wildcard and QoS errors
	_, isErr = callToolHelper(t, r, "publish_message", map[string]any{
		"topic":   "test/+/wildcard",
		"payload": "bad",
	})
	if !isErr {
		t.Fatal("expected error publishing to wildcard topic")
	}

	_, isErr = callToolHelper(t, r, "publish_message", map[string]any{
		"topic":   "test/bad_qos",
		"payload": "bad",
		"qos":     99,
	})
	if !isErr {
		t.Fatal("expected error publishing with invalid qos")
	}

	// 9. update_dashboard with cron and logic rules
	createTxt, isErr := callToolHelper(t, r, "create_dashboard", map[string]any{
		"name": "Cron Logic Dashboard",
		"panels": []map[string]any{
			{"panel_type": "button", "title": "B1"},
		},
	})
	if isErr {
		t.Fatalf("create failed: %s", createTxt)
	}
	var c struct {
		DashboardID string `json:"dashboard_id"`
	}
	json.Unmarshal([]byte(createTxt), &c)

	updTxt, isErr := callToolHelper(t, r, "update_dashboard", map[string]any{
		"dashboard_id": c.DashboardID,
		"mode":         "append",
		"panels": []map[string]any{
			{
				"title":      "Poll Job",
				"panel_type": "cron",
				"config_json": map[string]any{
					"cron_expr": "* * * * *",
					"topic":     "poll/test",
					"enabled":   true,
				},
			},
			{
				"title":      "Rule 1",
				"panel_type": "logic",
				"config_json": map[string]any{
					"source_topic": "src/1",
					"target_topic": "dst/1",
					"enabled":      true,
				},
			},
		},
	})
	if isErr || !strings.Contains(updTxt, `"total_panels": 3`) {
		t.Fatalf("update with cron/logic failed: %s", updTxt)
	}

	// 10. create_dashboard with dry_run: true
	dryTxt, isErr := callToolHelper(t, r, "create_dashboard", map[string]any{
		"name":    "Dry Run Dash",
		"dry_run": true,
		"panels": []map[string]any{
			{"panel_type": "text", "title": "Info"},
		},
	})
	if isErr || !strings.Contains(dryTxt, `"dry_run": true`) {
		t.Fatalf("create_dashboard with dry_run failed: %s", dryTxt)
	}

	// 11. update_dashboard with mode: "replace" and new name and broker match
	updReplaceTxt, isErr := callToolHelper(t, r, "update_dashboard", map[string]any{
		"dashboard_id": c.DashboardID,
		"name":         "Renamed Dashboard",
		"mode":         "replace",
		"panels": []map[string]any{
			{
				"title":       "New Panel",
				"panel_type":  "button",
				"broker_id":   "broker-1",
				"config_json": map[string]any{"topic": "btn/1"},
			},
			{
				"title":       "",
				"panel_type":  "toggle",
				"broker_name": "Local Mosquitto",
			},
		},
	})
	if isErr || !strings.Contains(updReplaceTxt, "Renamed Dashboard") {
		t.Fatalf("update_dashboard with replace and name failed: %s", updReplaceTxt)
	}

	// 12. update_dashboard with invalid mode
	_, isErr = callToolHelper(t, r, "update_dashboard", map[string]any{
		"dashboard_id": c.DashboardID,
		"mode":         "invalid_mode",
	})
	if !isErr {
		t.Fatal("expected error with invalid update mode")
	}

	// 13. delete_dashboard blocked when only 1 dashboard left
	// First delete all except 1
	var allDashIDs []string
	rows, _ := srv.db.Query(`SELECT id FROM dashboards`)
	for rows.Next() {
		var did string
		rows.Scan(&did)
		allDashIDs = append(allDashIDs, did)
	}
	rows.Close()
	for _, did := range allDashIDs[1:] {
		callToolHelper(t, r, "delete_dashboard", map[string]any{"dashboard_id": did})
	}
	// Now attempt to delete the last one
	_, isErr = callToolHelper(t, r, "delete_dashboard", map[string]any{
		"dashboard_id": allDashIDs[0],
	})
	if !isErr {
		t.Fatal("expected error deleting the last dashboard")
	}
}

func TestMCPResourcesAndPrompts(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	r := chi.NewRouter()
	srv.MountRoutes(r)

	// 1. resources/list
	resList := postJSONRPC(t, r, "resources/list", nil)
	if resList.Error != nil {
		t.Fatalf("resources/list error: %+v", resList.Error)
	}

	// 2. resources/read valid URI
	resRead := postJSONRPC(t, r, "resources/read", map[string]string{
		"uri": "mqtt-dashboard://schema/panels",
	})
	if resRead.Error != nil {
		t.Fatalf("resources/read error: %+v", resRead.Error)
	}

	// 3. resources/read invalid URI
	resReadBad := postJSONRPC(t, r, "resources/read", map[string]string{
		"uri": "unknown://uri",
	})
	if resReadBad.Error == nil {
		t.Fatal("expected error reading unknown resource URI")
	}

	// 4. prompts/list
	promptList := postJSONRPC(t, r, "prompts/list", nil)
	if promptList.Error != nil {
		t.Fatalf("prompts/list error: %+v", promptList.Error)
	}

	// 5. prompts/get valid
	promptGet := postJSONRPC(t, r, "prompts/get", map[string]any{
		"name": "design_dashboard",
		"arguments": map[string]string{
			"project": "Smart Greenhouse with humidity control",
		},
	})
	if promptGet.Error != nil {
		t.Fatalf("prompts/get error: %+v", promptGet.Error)
	}

	// 6. prompts/get invalid
	promptGetBad := postJSONRPC(t, r, "prompts/get", map[string]any{
		"name": "unknown_prompt",
	})
	if promptGetBad.Error == nil {
		t.Fatal("expected error getting unknown prompt")
	}

	// 7. tools/call with invalid params JSON
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":"not-an-object"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), "-32602") {
		t.Fatalf("expected -32602 error for invalid tool call params, got: %s", rec.Body.String())
	}
}
