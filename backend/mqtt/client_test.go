package mqtt

import (
	"fmt"
	"testing"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"

	"mqtt-dashboard/models"
)

// mockMessage implements paho.Message for testing.
type mockMessage struct {
	topic   string
	payload []byte
}

func (m *mockMessage) Duplicate() bool   { return false }
func (m *mockMessage) Qos() byte         { return 0 }
func (m *mockMessage) Retained() bool    { return false }
func (m *mockMessage) Topic() string     { return m.topic }
func (m *mockMessage) MessageID() uint16 { return 0 }
func (m *mockMessage) Payload() []byte   { return m.payload }
func (m *mockMessage) Ack()              {}

var _ paho.Message = (*mockMessage)(nil)

// mockToken implements paho.Token for testing.
type mockToken struct{ err error }

func (t *mockToken) Wait() bool                       { return true }
func (t *mockToken) WaitTimeout(_ time.Duration) bool { return true }
func (t *mockToken) Done() <-chan struct{}            { c := make(chan struct{}); close(c); return c }
func (t *mockToken) Error() error                     { return t.err }

var _ paho.Token = (*mockToken)(nil)

// mockPahoClient implements paho.Client for testing.
type mockPahoClient struct {
	connected        bool
	subscribeCalls   []string
	unsubscribeCalls []string
}

func (m *mockPahoClient) IsConnected() bool      { return m.connected }
func (m *mockPahoClient) IsConnectionOpen() bool { return m.connected }
func (m *mockPahoClient) Connect() paho.Token    { return &mockToken{} }
func (m *mockPahoClient) Disconnect(_ uint)      {}
func (m *mockPahoClient) Publish(_ string, _ byte, _ bool, _ interface{}) paho.Token {
	return &mockToken{}
}
func (m *mockPahoClient) Subscribe(topic string, _ byte, _ paho.MessageHandler) paho.Token {
	m.subscribeCalls = append(m.subscribeCalls, topic)
	return &mockToken{}
}
func (m *mockPahoClient) SubscribeMultiple(_ map[string]byte, _ paho.MessageHandler) paho.Token {
	return &mockToken{}
}
func (m *mockPahoClient) Unsubscribe(topics ...string) paho.Token {
	m.unsubscribeCalls = append(m.unsubscribeCalls, topics...)
	return &mockToken{}
}
func (m *mockPahoClient) AddRoute(_ string, _ paho.MessageHandler) {}
func (m *mockPahoClient) OptionsReader() paho.ClientOptionsReader {
	return paho.NewClient(paho.NewClientOptions()).OptionsReader()
}

var _ paho.Client = (*mockPahoClient)(nil)

// mockPahoClientWithErr lets tests inject a failing publish token.
type mockPahoClientWithErr struct {
	connected    bool
	publishToken paho.Token
}

func (m *mockPahoClientWithErr) IsConnected() bool      { return m.connected }
func (m *mockPahoClientWithErr) IsConnectionOpen() bool { return m.connected }
func (m *mockPahoClientWithErr) Connect() paho.Token    { return &mockToken{} }
func (m *mockPahoClientWithErr) Disconnect(_ uint)      {}
func (m *mockPahoClientWithErr) Publish(_ string, _ byte, _ bool, _ interface{}) paho.Token {
	return m.publishToken
}
func (m *mockPahoClientWithErr) Subscribe(_ string, _ byte, _ paho.MessageHandler) paho.Token {
	return &mockToken{}
}
func (m *mockPahoClientWithErr) SubscribeMultiple(_ map[string]byte, _ paho.MessageHandler) paho.Token {
	return &mockToken{}
}
func (m *mockPahoClientWithErr) Unsubscribe(_ ...string) paho.Token       { return &mockToken{} }
func (m *mockPahoClientWithErr) AddRoute(_ string, _ paho.MessageHandler) {}
func (m *mockPahoClientWithErr) OptionsReader() paho.ClientOptionsReader {
	return paho.NewClient(paho.NewClientOptions()).OptionsReader()
}

var _ paho.Client = (*mockPahoClientWithErr)(nil)

func TestNewManager_InitialState(t *testing.T) {
	m := NewManager()
	if m.Status() != "DISCONNECTED" {
		t.Errorf("initial status = %q, want DISCONNECTED", m.Status())
	}
	if m.subs == nil {
		t.Error("subs map should be initialised")
	}
}

func TestSubscribe_StoresHandlerWithoutClient(t *testing.T) {
	m := NewManager()
	called := false
	if err := m.Subscribe("test/topic", func(string, []byte, byte, bool) { called = true }); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	if len(m.subs["test/topic"]) != 1 {
		t.Errorf("subs count = %d, want 1", len(m.subs["test/topic"]))
	}
	_ = called
}

func TestSubscribe_MultipleHandlersSameTopic(t *testing.T) {
	m := NewManager()
	m.Subscribe("t", func(string, []byte, byte, bool) {}) //nolint
	m.Subscribe("t", func(string, []byte, byte, bool) {}) //nolint
	if len(m.subs["t"]) != 2 {
		t.Errorf("subs count = %d, want 2", len(m.subs["t"]))
	}
}

func TestUnsubscribe_RemovesLastHandler(t *testing.T) {
	m := NewManager()
	h1 := func(string, []byte, byte, bool) {}
	m.Subscribe("test", h1) //nolint

	m.Unsubscribe("test", h1)

	if _, ok := m.subs["test"]; ok {
		t.Error("expected 'test' key to be removed from subs map")
	}
}

func TestUnsubscribe_KeepsRemainingHandlers(t *testing.T) {
	m := NewManager()
	h1 := func(string, []byte, byte, bool) {}
	h2 := func(string, []byte, byte, bool) {}
	m.Subscribe("test", h1) //nolint
	m.Subscribe("test", h2) //nolint

	m.Unsubscribe("test", h1) // always removes the last appended handler

	if len(m.subs["test"]) != 1 {
		t.Errorf("subs count = %d, want 1 after unsubscribe", len(m.subs["test"]))
	}
}

func TestUnsubscribe_NonExistentTopicNoError(t *testing.T) {
	m := NewManager()
	// Should not panic
	m.Unsubscribe("nope", func(string, []byte, byte, bool) {})
}

func TestBuildHandler_DispatchesToHandlers(t *testing.T) {
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
	}

	var got string
	m.subs["sensor/temp"] = []MessageHandler{
		func(topic string, payload []byte, _ byte, _ bool) {
			got = topic + ":" + string(payload)
		},
	}

	handler := m.buildHandler("sensor/temp")
	handler(nil, &mockMessage{topic: "sensor/temp", payload: []byte("25")})

	if got != "sensor/temp:25" {
		t.Errorf("handler dispatch = %q, want 'sensor/temp:25'", got)
	}
}

func TestBuildHandler_WildcardDispatchesToSpecificHandlers(t *testing.T) {
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
	}

	wildcardCalls := 0
	specificCalls := 0
	m.subs["#"] = []MessageHandler{
		func(string, []byte, byte, bool) { wildcardCalls++ },
	}
	m.subs["sensor/temp"] = []MessageHandler{
		func(string, []byte, byte, bool) { specificCalls++ },
	}

	handler := m.buildHandler("#")
	handler(nil, &mockMessage{topic: "sensor/temp", payload: []byte("data")})

	if wildcardCalls != 1 {
		t.Errorf("wildcard handler called %d times, want 1", wildcardCalls)
	}
	if specificCalls != 1 {
		t.Errorf("specific handler called %d times via wildcard, want 1", specificCalls)
	}
}

func TestBuildHandler_WildcardDoesNotDoubleDispatch(t *testing.T) {
	// When topic == msgTopic (i.e. msg came in literally as "#"), no specific dispatch
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
	}
	calls := 0
	m.subs["#"] = []MessageHandler{func(string, []byte, byte, bool) { calls++ }}

	handler := m.buildHandler("#")
	handler(nil, &mockMessage{topic: "#", payload: []byte("x")})

	if calls != 1 {
		t.Errorf("calls = %d, want 1 (no double dispatch when topic == '#')", calls)
	}
}

func TestSetStatus_UpdatesStatusField(t *testing.T) {
	m := NewManager()
	m.setStatus("ERROR")
	if m.status != "ERROR" {
		t.Errorf("status = %q, want ERROR", m.status)
	}
}

func TestPublish_NotConnected(t *testing.T) {
	m := NewManager()
	err := m.Publish("test/topic", 0, false, []byte("data"))
	if err == nil {
		t.Error("expected error when publishing without connection")
	}
}

func TestSubscribe_WithConnectedClient_SubscribesMQTT(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	if err := m.Subscribe("sensor/temp", func(string, []byte, byte, bool) {}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	if len(mock.subscribeCalls) != 1 || mock.subscribeCalls[0] != "sensor/temp" {
		t.Errorf("expected MQTT Subscribe('sensor/temp'), got %v", mock.subscribeCalls)
	}
}

func TestSubscribe_WildcardUnsubscribesSpecifics(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	// Add a specific subscription first
	m.subs["sensor/temp"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	// Now subscribe to "#" — should unsubscribe sensor/temp at MQTT level
	if err := m.Subscribe("#", func(string, []byte, byte, bool) {}); err != nil {
		t.Fatalf("Subscribe #: %v", err)
	}

	if len(mock.unsubscribeCalls) == 0 {
		t.Error("expected Unsubscribe to be called for specific topics when '#' added")
	}
}

func TestSubscribe_SpecificSkippedWhenWildcardActive(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	// Wildcard already active
	m.subs["#"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	// Adding specific topic should NOT call MQTT subscribe (# already covers it)
	if err := m.Subscribe("sensor/temp", func(string, []byte, byte, bool) {}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	// mock.subscribeCalls should be empty since we skip MQTT sub when # is active
	if len(mock.subscribeCalls) != 0 {
		t.Errorf("expected no MQTT subscribe when '#' is active, got %v", mock.subscribeCalls)
	}
}

func TestUnsubscribe_WithConnectedClient_UnsubscribesMQTT(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	h := func(string, []byte, byte, bool) {}
	m.subs["test/topic"] = []MessageHandler{h}

	m.Unsubscribe("test/topic", h)

	if len(mock.unsubscribeCalls) == 0 {
		t.Error("expected MQTT Unsubscribe to be called when last handler removed")
	}
}

func TestUnsubscribe_SpecificWhenWildcardActive_NoMQTTUnsub(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	h := func(string, []byte, byte, bool) {}
	m.subs["sensor/temp"] = []MessageHandler{h}
	m.subs["#"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	// Removing a specific topic when '#' is active should NOT call MQTT Unsubscribe
	m.Unsubscribe("sensor/temp", h)

	if len(mock.unsubscribeCalls) != 0 {
		t.Errorf("expected no MQTT Unsubscribe when '#' is active, got %v", mock.unsubscribeCalls)
	}
}

func TestUnsubscribe_WildcardRemoved_RestoresSpecificTopics(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	wildcardH := func(string, []byte, byte, bool) {}
	m.subs["#"] = []MessageHandler{wildcardH}
	m.subs["sensor/temp"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	m.Unsubscribe("#", wildcardH)

	// Should call Unsubscribe("#") and then Subscribe specific topics
	if len(mock.unsubscribeCalls) == 0 {
		t.Error("expected MQTT Unsubscribe('#') to be called")
	}
	if len(mock.subscribeCalls) == 0 {
		t.Error("expected MQTT Subscribe for specific topics after '#' removed")
	}
}

func TestDisconnect_WithConnectedClient(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	m.Disconnect()

	if m.Status() != "DISCONNECTED" {
		t.Errorf("status after disconnect = %q, want DISCONNECTED", m.Status())
	}
}

func TestPublish_WithConnectedClient(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	if err := m.Publish("test/topic", 0, false, []byte("hello")); err != nil {
		t.Errorf("Publish: unexpected error: %v", err)
	}
}

func TestPublish_TokenError(t *testing.T) {
	badToken := &mockToken{err: fmt.Errorf("publish failed")}
	mock := &mockPahoClientWithErr{connected: true, publishToken: badToken}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	if err := m.Publish("test/topic", 0, false, []byte("hello")); err == nil {
		t.Error("expected error from token.Error(), got nil")
	}
}

// --- $SYS/# coverage tests ---

func TestSubscribe_SysWildcardUnsubscribesSpecificSysTopics(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	// Add a specific $SYS subscription first
	m.subs["$SYS/broker/uptime"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	// Now subscribe to "$SYS/#" — should unsubscribe $SYS/broker/uptime at MQTT level
	if err := m.Subscribe("$SYS/#", func(string, []byte, byte, bool) {}); err != nil {
		t.Fatalf("Subscribe $SYS/#: %v", err)
	}

	if len(mock.unsubscribeCalls) == 0 {
		t.Error("expected Unsubscribe to be called for specific $SYS topics when '$SYS/#' added")
	}
	found := false
	for _, c := range mock.unsubscribeCalls {
		if c == "$SYS/broker/uptime" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected '$SYS/broker/uptime' to be unsubscribed, got %v", mock.unsubscribeCalls)
	}
}

func TestSubscribe_SpecificSysSkippedWhenSysWildcardActive(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	// $SYS/# already active
	m.subs["$SYS/#"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	// Adding specific $SYS topic should NOT call MQTT subscribe ($SYS/# covers it)
	if err := m.Subscribe("$SYS/broker/uptime", func(string, []byte, byte, bool) {}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	if len(mock.subscribeCalls) != 0 {
		t.Errorf("expected no MQTT subscribe when '$SYS/#' is active, got %v", mock.subscribeCalls)
	}
}

func TestUnsubscribe_SpecificSysWhenSysWildcardActive_NoMQTTUnsub(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	h := func(string, []byte, byte, bool) {}
	m.subs["$SYS/broker/uptime"] = []MessageHandler{h}
	m.subs["$SYS/#"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	// Removing a specific $SYS topic when '$SYS/#' is active should NOT call MQTT Unsubscribe
	m.Unsubscribe("$SYS/broker/uptime", h)

	if len(mock.unsubscribeCalls) != 0 {
		t.Errorf("expected no MQTT Unsubscribe when '$SYS/#' is active, got %v", mock.unsubscribeCalls)
	}
}

func TestUnsubscribe_SysWildcardRemoved_RestoresSpecificSysTopics(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	sysWildcardH := func(string, []byte, byte, bool) {}
	m.subs["$SYS/#"] = []MessageHandler{sysWildcardH}
	m.subs["$SYS/broker/uptime"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	m.Unsubscribe("$SYS/#", sysWildcardH)

	// Should call Unsubscribe("$SYS/#") and then Subscribe specific $SYS topics
	foundUnsub := false
	for _, c := range mock.unsubscribeCalls {
		if c == "$SYS/#" {
			foundUnsub = true
		}
	}
	if !foundUnsub {
		t.Errorf("expected MQTT Unsubscribe('$SYS/#'), got %v", mock.unsubscribeCalls)
	}
	foundSub := false
	for _, c := range mock.subscribeCalls {
		if c == "$SYS/broker/uptime" {
			foundSub = true
		}
	}
	if !foundSub {
		t.Errorf("expected MQTT Subscribe('$SYS/broker/uptime') after '$SYS/#' removed, got %v", mock.subscribeCalls)
	}
}

func TestBuildHandler_SysWildcardDispatchesToSpecificSysHandlers(t *testing.T) {
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
	}

	sysWildcardCalls := 0
	specificSysCalls := 0
	m.subs["$SYS/#"] = []MessageHandler{
		func(string, []byte, byte, bool) { sysWildcardCalls++ },
	}
	m.subs["$SYS/broker/uptime"] = []MessageHandler{
		func(string, []byte, byte, bool) { specificSysCalls++ },
	}

	handler := m.buildHandler("$SYS/#")
	handler(nil, &mockMessage{topic: "$SYS/broker/uptime", payload: []byte("12345")})

	if sysWildcardCalls != 1 {
		t.Errorf("$SYS/# handler called %d times, want 1", sysWildcardCalls)
	}
	if specificSysCalls != 1 {
		t.Errorf("specific $SYS handler called %d times via $SYS/# dispatch, want 1", specificSysCalls)
	}
}

func TestBuildHandler_SysWildcardDoesNotDoubleDispatch(t *testing.T) {
	// When msgTopic == "$SYS/#", no specific dispatch should occur
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
	}
	calls := 0
	m.subs["$SYS/#"] = []MessageHandler{func(string, []byte, byte, bool) { calls++ }}

	handler := m.buildHandler("$SYS/#")
	handler(nil, &mockMessage{topic: "$SYS/#", payload: []byte("x")})

	if calls != 1 {
		t.Errorf("calls = %d, want 1 (no double dispatch when topic == '$SYS/#')", calls)
	}
}

func TestBuildHandler_WildcardSkipsSysWhenSysWildcardActive(t *testing.T) {
	// Paho's '#' matches $SYS topics at the client level. The '#' handler must
	// skip $SYS messages when '$SYS/#' is also registered to avoid duplicates.
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
	}
	hashCalls := 0
	m.subs["#"] = []MessageHandler{func(string, []byte, byte, bool) { hashCalls++ }}
	m.subs["$SYS/#"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	handler := m.buildHandler("#")
	handler(nil, &mockMessage{topic: "$SYS/broker/uptime", payload: []byte("123")})

	if hashCalls != 0 {
		t.Errorf("'#' handler called %d times for $SYS message when '$SYS/#' active, want 0", hashCalls)
	}
}

func TestBuildHandler_WildcardStillHandlesNonSysWhenSysWildcardActive(t *testing.T) {
	// The '#' handler must still process non-$SYS messages normally.
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
	}
	hashCalls := 0
	m.subs["#"] = []MessageHandler{func(string, []byte, byte, bool) { hashCalls++ }}
	m.subs["$SYS/#"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	handler := m.buildHandler("#")
	handler(nil, &mockMessage{topic: "sensor/temp", payload: []byte("25")})

	if hashCalls != 1 {
		t.Errorf("'#' handler called %d times for regular message, want 1", hashCalls)
	}
}

func TestUnsubscribe_WildcardRemoved_SkipsSysTopicsCoveredBySysWildcard(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		subs:   make(map[string][]MessageHandler),
		client: mock,
	}

	wildcardH := func(string, []byte, byte, bool) {}
	m.subs["#"] = []MessageHandler{wildcardH}
	m.subs["$SYS/#"] = []MessageHandler{func(string, []byte, byte, bool) {}}
	m.subs["$SYS/broker/uptime"] = []MessageHandler{func(string, []byte, byte, bool) {}}

	m.Unsubscribe("#", wildcardH)

	// When '#' is removed, specific $SYS topics covered by '$SYS/#' should
	// NOT be re-subscribed individually at the MQTT level.
	for _, c := range mock.subscribeCalls {
		if c == "$SYS/broker/uptime" {
			t.Error("should not re-subscribe '$SYS/broker/uptime' since '$SYS/#' covers it")
		}
	}
}

func TestConnect_InvalidCACert(t *testing.T) {
	m := NewManager()
	broker := models.MQTTBroker{
		Name:       "Test Broker",
		Host:       "127.0.0.1",
		Port:       1883,
		TLSEnabled: true,
		CACert:     "invalid cert content",
	}

	err := m.Connect(broker)
	if err == nil {
		t.Fatal("expected error with invalid CA cert")
	}
	if m.Status() != "ERROR" {
		t.Errorf("status = %q, want ERROR", m.Status())
	}
	if m.ConnectError() != "failed to parse CA certificate" {
		t.Errorf("connectErr = %q, want 'failed to parse CA certificate'", m.ConnectError())
	}
}

func TestConnect_InvalidClientCert(t *testing.T) {
	m := NewManager()
	broker := models.MQTTBroker{
		Name:       "Test Broker",
		Host:       "127.0.0.1",
		Port:       1883,
		TLSEnabled: true,
		AuthMode:   "certificate",
		ClientCert: "invalid cert",
		ClientKey:  "invalid key",
	}

	err := m.Connect(broker)
	if err == nil {
		t.Fatal("expected error with invalid client cert/key")
	}
	if m.Status() != "ERROR" {
		t.Errorf("status = %q, want ERROR", m.Status())
	}
	if m.ConnectError() == "" {
		t.Error("expected non-empty connectErr")
	}
}

func TestConnect_DisconnectsPreviousClient(t *testing.T) {
	mock := &mockPahoClient{connected: true}
	m := &MQTTManager{
		status: "CONNECTED",
		client: mock,
		subs:   make(map[string][]MessageHandler),
	}

	broker := models.MQTTBroker{
		Name:       "Test",
		Host:       "127.0.0.1",
		Port:       1883,
		TLSEnabled: true,
		CACert:     "invalid cert",
	}

	_ = m.Connect(broker)
	if m.Status() != "ERROR" {
		t.Errorf("status = %q, want ERROR", m.Status())
	}
}
