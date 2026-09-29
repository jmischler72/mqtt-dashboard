package logic_test

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"mqtt-dashboard/logic"
	mqttclient "mqtt-dashboard/mqtt"
)

type mockBrokerClient struct {
	mu           sync.Mutex
	publishes    []publishRecord
	subs         map[string][]mqttclient.MessageHandler
	unsubs       []string
	defaultID    string
	publishError error
}

type publishRecord struct {
	BrokerID string
	Topic    string
	QoS      byte
	Retain   bool
	Payload  string
	PanelID  string
}

func newMockBrokerClient() *mockBrokerClient {
	return &mockBrokerClient{
		subs:      make(map[string][]mqttclient.MessageHandler),
		defaultID: "default-broker",
	}
}

func (m *mockBrokerClient) DefaultBrokerID() string {
	return m.defaultID
}

func (m *mockBrokerClient) Publish(brokerID, topic string, qos byte, retain bool, payload []byte, panelID ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.publishError != nil {
		return m.publishError
	}
	pid := ""
	if len(panelID) > 0 {
		pid = panelID[0]
	}
	m.publishes = append(m.publishes, publishRecord{
		BrokerID: brokerID,
		Topic:    topic,
		QoS:      qos,
		Retain:   retain,
		Payload:  string(payload),
		PanelID:  pid,
	})
	return nil
}

func (m *mockBrokerClient) Subscribe(brokerID, topic string, handler mqttclient.MessageHandler) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := brokerID + "::" + topic
	m.subs[key] = append(m.subs[key], handler)
	return nil
}

func (m *mockBrokerClient) Unsubscribe(brokerID, topic string, handler mqttclient.MessageHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := brokerID + "::" + topic
	m.unsubs = append(m.unsubs, key)
	delete(m.subs, key)
}

func (m *mockBrokerClient) injectMessage(brokerID, topic string, payload string) {
	m.mu.Lock()
	key := brokerID + "::" + topic
	handlers := make([]mqttclient.MessageHandler, len(m.subs[key]))
	copy(handlers, m.subs[key])
	m.mu.Unlock()

	for _, h := range handlers {
		h(topic, []byte(payload), 0, false, "")
	}
}

func (m *mockBrokerClient) getPublishes() []publishRecord {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]publishRecord, len(m.publishes))
	copy(cp, m.publishes)
	return cp
}

func (m *mockBrokerClient) clearPublishes() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.publishes = nil
}

func TestValidateRule(t *testing.T) {
	tests := []struct {
		name    string
		rule    *logic.Rule
		wantErr bool
	}{
		{
			name: "valid minimal rule",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/fan",
			},
			wantErr: false,
		},
		{
			name: "missing source topic",
			rule: &logic.Rule{
				PanelID:     "p1",
				TargetTopic: "relays/fan",
			},
			wantErr: true,
		},
		{
			name: "missing target topic",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
			},
			wantErr: true,
		},
		{
			name: "target has wildcard plus",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/+/set",
			},
			wantErr: true,
		},
		{
			name: "target has wildcard hash",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/#",
			},
			wantErr: true,
		},
		{
			name: "infinite loop exact match",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "sensors/temp",
			},
			wantErr: true,
		},
		{
			name: "infinite loop wildcard source match",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/#",
				TargetTopic: "sensors/temp",
			},
			wantErr: true,
		},
		{
			name: "different target broker allows same topic without loop",
			rule: &logic.Rule{
				PanelID:        "p1",
				BrokerID:       "b1",
				TargetBrokerID: "b2",
				SourceTopic:    "sensors/temp",
				TargetTopic:    "sensors/temp",
			},
			wantErr: false,
		},
		{
			name: "invalid numeric condition value",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/fan",
				Conditions: []logic.Condition{
					{Operator: "gt", Value: "not-a-number"},
				},
			},
			wantErr: true,
		},
		{
			name: "invalid condition join",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/fan",
				Conditions: []logic.Condition{
					{Operator: "gt", Value: "10"},
					{Join: "xor", Operator: "lt", Value: "20"},
				},
			},
			wantErr: true,
		},
		{
			name: "unknown operator",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/fan",
				Conditions: []logic.Condition{
					{Operator: "foo", Value: "123"},
				},
			},
			wantErr: true,
		},
		{
			name: "invalid mode",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/fan",
				Mode:        "invalid-mode",
			},
			wantErr: true,
		},
		{
			name: "negative cooldown",
			rule: &logic.Rule{
				PanelID:     "p1",
				SourceTopic: "sensors/temp",
				TargetTopic: "relays/fan",
				CooldownSec: -1,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := logic.ValidateRule(tt.rule)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateRule() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestEngine_BasicPublishTemplating(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	rule := &logic.Rule{
		PanelID:     "p1",
		BrokerID:    "b1",
		SourceTopic: "sensors/temp",
		TargetTopic: "fan/set, alerts/temp",
		Payload:     `{"val":{{value}}}`,
		QoS:         1,
		Retain:      true,
		Enabled:     true,
		Conditions: []logic.Condition{
			{Operator: "gt", Value: "30"},
		},
		Mode: "every",
	}

	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// Below condition (25 <= 30) -> should NOT fire
	broker.injectMessage("b1", "sensors/temp", "25")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 0 {
		t.Fatalf("expected 0 publishes, got %d", len(broker.getPublishes()))
	}

	// Above condition (35 > 30) -> should fire on both target topics
	broker.injectMessage("b1", "sensors/temp", "35")
	time.Sleep(50 * time.Millisecond)

	pubs := broker.getPublishes()
	if len(pubs) != 2 {
		t.Fatalf("expected 2 publishes, got %d", len(pubs))
	}

	if pubs[0].Topic != "fan/set" || pubs[0].Payload != `{"val":35}` {
		t.Errorf("unexpected publish 0: %+v", pubs[0])
	}
	if pubs[1].Topic != "alerts/temp" {
		t.Errorf("unexpected publish 1 topic: %s", pubs[1].Topic)
	}
	if pubs[0].QoS != 1 || !pubs[0].Retain || pubs[0].PanelID != "p1" {
		t.Errorf("unexpected QoS/Retain/PanelID: %+v", pubs[0])
	}

	// Verify status
	status, ok := engine.GetStatus("p1")
	if !ok || status.FireCount != 1 || status.LastFired == nil {
		t.Errorf("unexpected status: %+v", status)
	}
}

func TestEngine_ValueTokenTemplating(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	// Rule 1: uses {value} token with raw payload
	rule1 := &logic.Rule{
		PanelID:     "p_val1",
		BrokerID:    "b1",
		SourceTopic: "sensor/raw",
		TargetTopic: "actuator/target",
		Payload:     `{"state":{value}}`,
		Enabled:     true,
		Mode:        "every",
	}
	if err := engine.AddRule(rule1); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// Rule 2: uses {value} token with condition ReadTemplate extraction
	rule2 := &logic.Rule{
		PanelID:     "p_val2",
		BrokerID:    "b1",
		SourceTopic: "sensor/json",
		TargetTopic: "actuator/json_target",
		Payload:     `{"relayed":{value}}`,
		Enabled:     true,
		Conditions: []logic.Condition{
			{
				Operator:     "gt",
				Value:        "20",
				ReadTemplate: `{"sensor":{"temp":{value}}}`,
			},
		},
		Mode: "every",
	}
	if err := engine.AddRule(rule2); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	broker.injectMessage("b1", "sensor/raw", "42")
	time.Sleep(50 * time.Millisecond)

	pubs := broker.getPublishes()
	if len(pubs) != 1 {
		t.Fatalf("expected 1 publish, got %d", len(pubs))
	}
	if pubs[0].Payload != `{"state":42}` {
		t.Errorf("expected {state:42}, got %s", pubs[0].Payload)
	}

	broker.clearPublishes()
	broker.injectMessage("b1", "sensor/json", `{"sensor":{"temp":28}}`)
	time.Sleep(50 * time.Millisecond)

	pubs = broker.getPublishes()
	if len(pubs) != 1 {
		t.Fatalf("expected 1 publish, got %d", len(pubs))
	}
	if pubs[0].Payload != `{"relayed":28}` {
		t.Errorf("expected {relayed:28}, got %s", pubs[0].Payload)
	}
}

func TestEngine_Modes(t *testing.T) {
	t.Run("on_change mode", func(t *testing.T) {
		broker := newMockBrokerClient()
		engine := logic.NewEngine(broker)
		defer engine.Stop()

		rule := &logic.Rule{
			PanelID:     "p_change",
			BrokerID:    "b1",
			SourceTopic: "sensor/temp",
			TargetTopic: "fan/cmd",
			Payload:     "ON",
			Enabled:     true,
			Mode:        "on_change",
			Conditions: []logic.Condition{
				{Operator: "gt", Value: "30"},
			},
		}
		if err := engine.AddRule(rule); err != nil {
			t.Fatalf("AddRule: %v", err)
		}

		// 1st publish: 35 -> fires (false -> true)
		broker.injectMessage("b1", "sensor/temp", "35")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(broker.getPublishes()))
		}

		// 2nd publish: 40 -> remains true, should NOT fire again
		broker.injectMessage("b1", "sensor/temp", "40")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(broker.getPublishes()))
		}

		// 3rd publish: 20 -> condition false
		broker.injectMessage("b1", "sensor/temp", "20")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(broker.getPublishes()))
		}

		// 4th publish: 32 -> condition true again -> fires second time!
		broker.injectMessage("b1", "sensor/temp", "32")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 2 {
			t.Fatalf("expected 2 publishes, got %d", len(broker.getPublishes()))
		}
	})

	t.Run("on_change mode with scalar payload and JSONPath configured", func(t *testing.T) {
		broker := newMockBrokerClient()
		engine := logic.NewEngine(broker)
		defer engine.Stop()

		rule := &logic.Rule{
			PanelID:     "p_change_scalar",
			BrokerID:    "b1",
			SourceTopic: "sensors/bathroom/humidity",
			TargetTopic: "cond/status",
			Payload:     "{value} ok",
			Enabled:     true,
			Mode:        "on_change",
			Conditions: []logic.Condition{
				{
					Operator:     "gt",
					Value:        "30",
					JSONPath:     "value",
					ReadTemplate: `{"value": {value}, "unit": "%"}`,
				},
			},
		}
		if err := engine.AddRule(rule); err != nil {
			t.Fatalf("AddRule: %v", err)
		}

		// 1. Scalar "0" -> not matching (0 <= 30) -> no publish
		broker.injectMessage("b1", "sensors/bathroom/humidity", "0")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 0 {
			t.Fatalf("expected 0 publishes, got %d", len(broker.getPublishes()))
		}

		// 2. Scalar "40" -> matches (40 > 30) -> fires!
		broker.injectMessage("b1", "sensors/bathroom/humidity", "40")
		time.Sleep(50 * time.Millisecond)
		pubs := broker.getPublishes()
		if len(pubs) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(pubs))
		}
		if pubs[0].Payload != "40 ok" {
			t.Errorf("expected '40 ok', got %q", pubs[0].Payload)
		}

		// 3. Scalar "40" again -> remains true -> should not fire
		broker.injectMessage("b1", "sensors/bathroom/humidity", "40")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(broker.getPublishes()))
		}

		// 4. Scalar "0" -> condition becomes false
		broker.injectMessage("b1", "sensors/bathroom/humidity", "0")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(broker.getPublishes()))
		}

		// 5. Scalar "40" -> condition true again -> fires 2nd time!
		broker.injectMessage("b1", "sensors/bathroom/humidity", "40")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 2 {
			t.Fatalf("expected 2 publishes, got %d", len(broker.getPublishes()))
		}
	})

	t.Run("count mode", func(t *testing.T) {
		broker := newMockBrokerClient()
		engine := logic.NewEngine(broker)
		defer engine.Stop()

		rule := &logic.Rule{
			PanelID:     "p_count",
			BrokerID:    "b1",
			SourceTopic: "sensor/motion",
			TargetTopic: "alarm/trigger",
			Payload:     "ALARM",
			Enabled:     true,
			Mode:        "count",
			Count:       3,
			WindowSec:   10,
			Conditions: []logic.Condition{
				{Operator: "eq", Value: "detected"},
			},
		}
		if err := engine.AddRule(rule); err != nil {
			t.Fatalf("AddRule: %v", err)
		}

		broker.injectMessage("b1", "sensor/motion", "detected")
		time.Sleep(20 * time.Millisecond)
		status, _ := engine.GetStatus("p_count")
		if status.CurrentState != "waiting 1/3" {
			t.Errorf("expected state 'waiting 1/3', got %q", status.CurrentState)
		}

		broker.injectMessage("b1", "sensor/motion", "detected")
		time.Sleep(20 * time.Millisecond)
		status, _ = engine.GetStatus("p_count")
		if status.CurrentState != "waiting 2/3" {
			t.Errorf("expected state 'waiting 2/3', got %q", status.CurrentState)
		}

		// 3rd hit -> fires!
		broker.injectMessage("b1", "sensor/motion", "detected")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish on 3rd count, got %d", len(broker.getPublishes()))
		}
	})

	t.Run("sustained mode timer and cancellation", func(t *testing.T) {
		broker := newMockBrokerClient()
		engine := logic.NewEngine(broker)
		defer engine.Stop()

		rule := &logic.Rule{
			PanelID:      "p_sustained",
			BrokerID:     "b1",
			SourceTopic:  "sensor/temp",
			TargetTopic:  "fan/high",
			Payload:      "ON",
			Enabled:      true,
			Mode:         "sustained",
			SustainedSec: 1, // 1 second for test
			Conditions: []logic.Condition{
				{Operator: "gt", Value: "30"},
			},
		}
		if err := engine.AddRule(rule); err != nil {
			t.Fatalf("AddRule: %v", err)
		}

		// Step A: Cancellation before duration expires
		broker.injectMessage("b1", "sensor/temp", "35")
		time.Sleep(100 * time.Millisecond)
		status, _ := engine.GetStatus("p_sustained")
		if status.CurrentState != "true for 0s / 1s" && status.CurrentState != "true for 1s / 1s" {
			t.Logf("sustained state: %s", status.CurrentState)
		}

		// Condition goes false before 1 second -> cancels timer
		broker.injectMessage("b1", "sensor/temp", "20")
		time.Sleep(1100 * time.Millisecond)
		if len(broker.getPublishes()) != 0 {
			t.Fatalf("expected 0 publishes after cancellation, got %d", len(broker.getPublishes()))
		}

		// Step B: True and remains true for full sustained duration -> fires!
		broker.injectMessage("b1", "sensor/temp", "38")
		time.Sleep(1200 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish after sustained duration, got %d", len(broker.getPublishes()))
		}
	})
}

func TestEngine_JSONPath_And_Operators(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	rule := &logic.Rule{
		PanelID:     "p_json",
		BrokerID:    "b1",
		SourceTopic: "devices/thermostat",
		TargetTopic: "hvac/cmd",
		Payload:     "COOL",
		Enabled:     true,
		Mode:        "every",
		Conditions: []logic.Condition{
			{JSONPath: "data.temp", Operator: "gte", Value: "25.5"},
			{JSONPath: "status.mode", Operator: "eq", Value: "auto"},
			{JSONPath: "name", Operator: "contains", Value: "LivingRoom"},
			{JSONPath: "tags[0]", Operator: "exists"},
		},
		Match: "all",
	}
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// 1. Non-matching JSON (temp is 24 < 25.5)
	broker.injectMessage("b1", "devices/thermostat", `{"name":"LivingRoom-1","data":{"temp":24},"status":{"mode":"auto"},"tags":["hvac"]}`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 0 {
		t.Fatalf("expected 0 publishes, got %d", len(broker.getPublishes()))
	}

	// 2. Non-JSON payload -> fails closed
	broker.injectMessage("b1", "devices/thermostat", `raw text payload`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 0 {
		t.Fatalf("expected 0 publishes for non-json, got %d", len(broker.getPublishes()))
	}

	// 3. Matching JSON
	broker.injectMessage("b1", "devices/thermostat", `{"name":"LivingRoom-1","data":{"temp":26.2},"status":{"mode":"auto"},"tags":["hvac"]}`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish for matching json, got %d", len(broker.getPublishes()))
	}
}

func TestEngine_GuardTopics(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	// Rule triggers on sensors/temp, but has guard condition on doors/window
	rule := &logic.Rule{
		PanelID:     "p_guard",
		BrokerID:    "b1",
		SourceTopic: "sensors/temp",
		TargetTopic: "ac/set",
		Payload:     "ON",
		Enabled:     true,
		Mode:        "every",
		Conditions: []logic.Condition{
			{Operator: "gt", Value: "25"},                            // trigger payload
			{Topic: "doors/window", Operator: "eq", Value: "closed"}, // guard topic
		},
		Match: "all",
	}
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// Trigger arrives before guard topic has ever published -> fails closed (0 publishes)
	broker.injectMessage("b1", "sensors/temp", "30")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 0 {
		t.Fatalf("expected 0 publishes when guard has never published, got %d", len(broker.getPublishes()))
	}

	// Guard publishes "open"
	broker.injectMessage("b1", "doors/window", "open")
	time.Sleep(50 * time.Millisecond)
	broker.injectMessage("b1", "sensors/temp", "30")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 0 {
		t.Fatalf("expected 0 publishes when guard is 'open', got %d", len(broker.getPublishes()))
	}

	// Guard publishes "closed"
	broker.injectMessage("b1", "doors/window", "closed")
	time.Sleep(50 * time.Millisecond)
	broker.injectMessage("b1", "sensors/temp", "30")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish when guard is 'closed', got %d", len(broker.getPublishes()))
	}
}

func TestEngine_Cooldown_And_RateCeiling(t *testing.T) {
	t.Run("cooldown suppression", func(t *testing.T) {
		broker := newMockBrokerClient()
		engine := logic.NewEngine(broker)
		defer engine.Stop()

		rule := &logic.Rule{
			PanelID:     "p_cd",
			BrokerID:    "b1",
			SourceTopic: "sensor/test",
			TargetTopic: "out/test",
			Payload:     "1",
			Enabled:     true,
			Mode:        "every",
			CooldownSec: 5,
		}
		if err := engine.AddRule(rule); err != nil {
			t.Fatalf("AddRule: %v", err)
		}

		// 1st: fires
		broker.injectMessage("b1", "sensor/test", "a")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(broker.getPublishes()))
		}

		// 2nd immediately: suppressed by cooldown
		broker.injectMessage("b1", "sensor/test", "b")
		time.Sleep(50 * time.Millisecond)
		if len(broker.getPublishes()) != 1 {
			t.Fatalf("expected still 1 publish, got %d", len(broker.getPublishes()))
		}

		status, _ := engine.GetStatus("p_cd")
		if !strings.HasPrefix(status.CurrentState, "cooling down") {
			t.Errorf("expected status 'cooling down...', got %q", status.CurrentState)
		}
	})

	t.Run("rate ceiling trip", func(t *testing.T) {
		broker := newMockBrokerClient()
		engine := logic.NewEngine(broker)
		defer engine.Stop()

		rule := &logic.Rule{
			PanelID:     "p_trip",
			BrokerID:    "b1",
			SourceTopic: "sensor/fast",
			TargetTopic: "out/fast",
			Payload:     "FIRE",
			Enabled:     true,
			Mode:        "every",
		}
		if err := engine.AddRule(rule); err != nil {
			t.Fatalf("AddRule: %v", err)
		}

		// Inject 12 rapid messages within 100ms
		for i := 0; i < 12; i++ {
			broker.injectMessage("b1", "sensor/fast", fmt.Sprintf("msg-%d", i))
		}
		time.Sleep(100 * time.Millisecond)

		status, _ := engine.GetStatus("p_trip")
		if status.CurrentState != "tripped" || status.Enabled {
			t.Errorf("expected rule to be tripped and disabled, got status: %+v", status)
		}
	})
}

func TestEngine_Lifecycle(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	rule := &logic.Rule{
		PanelID:     "p_life",
		BrokerID:    "b1",
		SourceTopic: "sensor/life",
		TargetTopic: "out/life",
		Payload:     "OK",
		Enabled:     true,
		Mode:        "every",
	}

	// AddRule
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// Bad update does not clobber existing rule
	badRule := &logic.Rule{
		PanelID:     "p_life",
		SourceTopic: "", // invalid!
		TargetTopic: "out/life",
	}
	if err := engine.AddRule(badRule); err == nil {
		t.Fatal("expected error for bad rule")
	}

	got, ok := engine.GetRule("p_life")
	if !ok || got.SourceTopic != "sensor/life" {
		t.Fatalf("expected existing rule preserved, got %+v", got)
	}

	// ToggleRule
	if err := engine.ToggleRule("p_life", false); err != nil {
		t.Fatalf("ToggleRule(false): %v", err)
	}
	broker.injectMessage("b1", "sensor/life", "hello")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 0 {
		t.Fatalf("disabled rule should not publish")
	}

	if err := engine.ToggleRule("p_life", true); err != nil {
		t.Fatalf("ToggleRule(true): %v", err)
	}
	broker.injectMessage("b1", "sensor/life", "hello")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("enabled rule should publish")
	}

	// RemoveRule
	engine.RemoveRule("p_life")
	if _, ok := engine.GetRule("p_life"); ok {
		t.Fatalf("rule should be deleted")
	}

	// Remove non-existent is no-op
	engine.RemoveRule("non-existent")

	// Toggle non-existent returns error
	if err := engine.ToggleRule("non-existent", true); err == nil {
		t.Fatalf("expected error toggling non-existent rule")
	}

	// AddRule nil
	if err := engine.AddRule(nil); err == nil {
		t.Fatalf("expected error adding nil rule")
	}

	// AddRule to stopped engine
	engine.Stop()
	if err := engine.AddRule(rule); err == nil {
		t.Fatalf("expected error adding rule to stopped engine")
	}
}

func TestOperatorsDetailed(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	rule := &logic.Rule{
		PanelID:     "p_ops",
		BrokerID:    "b1",
		SourceTopic: "test/ops",
		TargetTopic: "out/ops",
		Payload:     "OK",
		Enabled:     true,
		Mode:        "every",
		Match:       "any",
		Conditions: []logic.Condition{
			{Operator: "lt", Value: "10"},
			{Operator: "lte", Value: "5"},
			{Operator: "gte", Value: "100"},
			{Operator: "ne", Value: "bad"},
			{Operator: "any"},
		},
	}
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	broker.injectMessage("b1", "test/ops", "3")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish for lt, got %d", len(broker.getPublishes()))
	}
}

func TestJSONPathDetailed(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	rule := &logic.Rule{
		PanelID:     "p_json_detailed",
		BrokerID:    "b1",
		SourceTopic: "test/json",
		TargetTopic: "out/json",
		Payload:     "HIT",
		Enabled:     true,
		Mode:        "every",
		Conditions: []logic.Condition{
			{JSONPath: "active", Operator: "eq", Value: "true"},
			{JSONPath: "empty", Operator: "eq", Value: "null"},
			{JSONPath: "users.0.name", Operator: "ne", Value: "Alice"},
		},
	}
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// Matches
	broker.injectMessage("b1", "test/json", `{"active":true,"empty":null,"users":[{"name":"Bob"}]}`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish for json path match, got %d", len(broker.getPublishes()))
	}

	// Array out of bounds -> fails closed
	broker.injectMessage("b1", "test/json", `{"active":true,"empty":null,"users":[]}`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected still 1 publish, got %d", len(broker.getPublishes()))
	}
}

func TestEngine_WithNowFunc_And_UpdateRule(t *testing.T) {
	fixedNow := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker, logic.WithNowFunc(func() time.Time {
		return fixedNow
	}))
	defer engine.Stop()

	rule := &logic.Rule{
		PanelID:     "p_clock",
		BrokerID:    "", // test effective broker fallback
		SourceTopic: "test/clock",
		TargetTopic: "out/clock",
		Payload:     "FIRE",
		Enabled:     true,
		Mode:        "every",
	}
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// Update existing rule (replaces cleanly)
	ruleUpdated := &logic.Rule{
		PanelID:     "p_clock",
		BrokerID:    "",
		SourceTopic: "test/clock2",
		TargetTopic: "out/clock2",
		Payload:     "FIRE2",
		Enabled:     true,
		Mode:        "every",
	}
	if err := engine.AddRule(ruleUpdated); err != nil {
		t.Fatalf("AddRule update: %v", err)
	}

	broker.injectMessage("default-broker", "test/clock2", "hi")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish on updated rule, got %d", len(broker.getPublishes()))
	}

	// Toggle same state
	if err := engine.ToggleRule("p_clock", true); err != nil {
		t.Fatalf("ToggleRule same state: %v", err)
	}
}

func TestEngine_ConditionJoins(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	// Rule: (C1 AND C2) OR C3
	// C1: > 20
	// C2: < 30 (Join: "and")
	// C3: == 99 (Join: "or")
	rule := &logic.Rule{
		PanelID:     "p_joins",
		BrokerID:    "b1",
		SourceTopic: "test/num",
		TargetTopic: "out/num",
		Payload:     "HIT",
		Enabled:     true,
		Mode:        "every",
		Conditions: []logic.Condition{
			{Operator: "gt", Value: "20"},
			{Join: "and", Operator: "lt", Value: "30"},
			{Join: "or", Operator: "eq", Value: "99"},
		},
	}
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// 25: (25>20) AND (25<30) -> T; T OR (25==99) -> T => Fires
	broker.injectMessage("b1", "test/num", "25")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish for 25, got %d", len(broker.getPublishes()))
	}

	// 35: (35>20) AND (35<30) -> F; F OR (35==99) -> F => Does not fire
	broker.injectMessage("b1", "test/num", "35")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected still 1 publish for 35, got %d", len(broker.getPublishes()))
	}

	// 99: (99>20) AND (99<30) -> F; F OR (99==99) -> T => Fires
	broker.injectMessage("b1", "test/num", "99")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 2 {
		t.Fatalf("expected 2 publishes after 99, got %d", len(broker.getPublishes()))
	}
}

func TestEngine_Templates(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	// 1. JSON ReadTemplate derivation
	ruleJSON := &logic.Rule{
		PanelID:     "p_tmpl_json",
		BrokerID:    "b1",
		SourceTopic: "test/json_tmpl",
		TargetTopic: "out/tmpl",
		Payload:     "JSON_OK",
		Enabled:     true,
		Mode:        "every",
		Conditions: []logic.Condition{
			{
				ReadTemplate: `{"sensor":{"temp":{value}}}`,
				Operator:     "gte",
				Value:        "25",
			},
		},
	}
	if err := engine.AddRule(ruleJSON); err != nil {
		t.Fatalf("AddRule JSON: %v", err)
	}

	broker.injectMessage("b1", "test/json_tmpl", `{"sensor":{"temp":28}}`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish for JSON template, got %d", len(broker.getPublishes()))
	}

	// 2. Stencil non-JSON ReadTemplate
	ruleStencil := &logic.Rule{
		PanelID:     "p_tmpl_stencil",
		BrokerID:    "b1",
		SourceTopic: "test/stencil_tmpl",
		TargetTopic: "out/tmpl",
		Payload:     "STENCIL_OK",
		Enabled:     true,
		Mode:        "every",
		Conditions: []logic.Condition{
			{
				ReadTemplate: `temp={value}C`,
				Operator:     "eq",
				Value:        "30",
			},
		},
	}
	if err := engine.AddRule(ruleStencil); err != nil {
		t.Fatalf("AddRule Stencil: %v", err)
	}

	broker.injectMessage("b1", "test/stencil_tmpl", `temp=30C`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 2 {
		t.Fatalf("expected 2 publishes after stencil match, got %d", len(broker.getPublishes()))
	}

	// Stencil mismatch
	broker.injectMessage("b1", "test/stencil_tmpl", `temp=25C`)
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 2 {
		t.Fatalf("expected still 2 publishes for stencil mismatch, got %d", len(broker.getPublishes()))
	}
}

func TestEngine_PerConditionBroker(t *testing.T) {
	broker := newMockBrokerClient()
	engine := logic.NewEngine(broker)
	defer engine.Stop()

	rule := &logic.Rule{
		PanelID:     "p_multi_broker",
		BrokerID:    "b1",
		SourceTopic: "sensor/temp",
		TargetTopic: "actuator/pump",
		Payload:     "RUN",
		Enabled:     true,
		Mode:        "every",
		Conditions: []logic.Condition{
			{Operator: "gt", Value: "20"},
			{BrokerID: "b2", Topic: "system/power", Operator: "eq", Value: "ON"},
		},
	}
	if err := engine.AddRule(rule); err != nil {
		t.Fatalf("AddRule: %v", err)
	}

	// Trigger arrives while b2 guard has not published -> fail closed
	broker.injectMessage("b1", "sensor/temp", "25")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 0 {
		t.Fatalf("expected 0 publishes before b2 guard, got %d", len(broker.getPublishes()))
	}

	// b2 guard arrives with "ON"
	broker.injectMessage("b2", "system/power", "ON")
	time.Sleep(50 * time.Millisecond)
	broker.injectMessage("b1", "sensor/temp", "25")
	time.Sleep(50 * time.Millisecond)
	if len(broker.getPublishes()) != 1 {
		t.Fatalf("expected 1 publish after b2 guard published ON, got %d", len(broker.getPublishes()))
	}

	// Remove rule and verify unsubscriptions
	engine.RemoveRule("p_multi_broker")
	foundB2Unsub := false
	for _, u := range broker.unsubs {
		if strings.Contains(u, "b2::system/power") {
			foundB2Unsub = true
			break
		}
	}
	if !foundB2Unsub {
		t.Errorf("expected b2::system/power in unsubs, got %v", broker.unsubs)
	}
}
