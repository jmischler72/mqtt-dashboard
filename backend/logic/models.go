package logic

import "time"

// Condition defines a single evaluation criterion.
type Condition struct {
	BrokerID     string `json:"broker_id,omitempty"`     // "" = rule.BrokerID; otherwise specific broker
	Topic        string `json:"topic,omitempty"`         // "" = trigger topic; otherwise guard topic
	JSONPath     string `json:"json_path,omitempty"`     // "" = whole payload; otherwise dot/bracket path
	ReadTemplate string `json:"read_template,omitempty"` // shape template with {value} (from PayloadBuilder)
	Operator     string `json:"operator"`                // "any"|"eq"|"ne"|"gt"|"lt"|"gte"|"lte"|"contains"|"exists"
	Value        string `json:"value,omitempty"`
	Join         string `json:"join,omitempty"` // "and" | "or" (for conditions at index > 0)
}

// Rule holds the full automation configuration for a logic panel.
type Rule struct {
	PanelID        string      `json:"panel_id"`
	BrokerID       string      `json:"broker_id,omitempty"`
	SourceTopic    string      `json:"source_topic"`
	Match          string      `json:"match,omitempty"` // "all" | "any" (default: "all")
	Conditions     []Condition `json:"conditions,omitempty"`
	Mode           string      `json:"mode,omitempty"` // "every"|"on_change"|"count"|"sustained" (default: "on_change")
	Count          int         `json:"count,omitempty"`
	WindowSec      int         `json:"window_sec,omitempty"`
	SustainedSec   int         `json:"sustained_sec,omitempty"`
	TargetTopic    string      `json:"target_topic"`
	TargetBrokerID string      `json:"target_broker_id,omitempty"`
	Payload        string      `json:"payload,omitempty"`
	QoS            byte        `json:"qos,omitempty"`
	Retain         bool        `json:"retain,omitempty"`
	CooldownSec    int         `json:"cooldown_sec,omitempty"`
	Enabled        bool        `json:"enabled"`
}

// RuleStatus represents the observable state of a rule for API consumers.
type RuleStatus struct {
	PanelID      string     `json:"panel_id"`
	Enabled      bool       `json:"enabled"`
	LastFired    *time.Time `json:"last_fired,omitempty"`
	FireCount    int        `json:"fire_count"`
	CurrentState string     `json:"current_state"` // "idle" | "waiting X/Y" | "true for Xs / Ys" | "cooling down Xs" | "tripped"
}

// Message is an incoming MQTT message payload and metadata.
type Message struct {
	BrokerID      string
	Topic         string
	Payload       []byte
	QoS           byte
	Retained      bool
	SourcePanelID string
}

// Action describes an MQTT publish action to be executed when a rule fires.
type Action struct {
	TargetBrokerID string
	TargetTopic    string
	Payload        []byte
	QoS            byte
	Retain         bool
}

// GuardLookup is a function to query the latest known payload for a broker and guard topic.
type GuardLookup func(brokerID, topic string) (string, bool)
