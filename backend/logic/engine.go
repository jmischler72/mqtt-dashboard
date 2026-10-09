package logic

import (
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	mqttclient "mqtt-dashboard/mqtt"
)

type brokerTopic struct {
	brokerID string
	topic    string
}

// Engine implements LogicEngine, managing event-driven automation rules.
type Engine struct {
	mu     sync.RWMutex
	broker BrokerClient

	rules         map[string]*Rule
	ruleStates    map[string]*ruleState
	topicHandlers map[brokerTopic]mqttclient.MessageHandler
	topicRules    map[brokerTopic]map[string]struct{} // (brokerID, topicFilter) -> set of panelIDs (triggers)
	guardSubs     map[brokerTopic]map[string]struct{} // (brokerID, topicFilter) -> set of panelIDs (guards)
	guardCache    map[string]map[string]string        // brokerID -> topic -> lastKnownPayload

	nowFunc func() time.Time
	stopped bool
}

// Option allows customizing engine behavior (e.g. for testing).
type Option func(*Engine)

// WithNowFunc configures a custom clock function for deterministic tests.
func WithNowFunc(fn func() time.Time) Option {
	return func(e *Engine) {
		e.nowFunc = fn
	}
}

// NewEngine creates an operational LogicEngine.
func NewEngine(broker BrokerClient, opts ...Option) *Engine {
	e := &Engine{
		broker:        broker,
		rules:         make(map[string]*Rule),
		ruleStates:    make(map[string]*ruleState),
		topicHandlers: make(map[brokerTopic]mqttclient.MessageHandler),
		topicRules:    make(map[brokerTopic]map[string]struct{}),
		guardSubs:     make(map[brokerTopic]map[string]struct{}),
		guardCache:    make(map[string]map[string]string),
		nowFunc:       time.Now,
	}
	for _, opt := range opts {
		opt(e)
	}
	return e
}

func (e *Engine) now() time.Time {
	if e.nowFunc != nil {
		return e.nowFunc()
	}
	return time.Now()
}

func (e *Engine) effectiveBroker(brokerID string) string {
	if brokerID != "" {
		return brokerID
	}
	if e.broker != nil {
		return e.broker.DefaultBrokerID()
	}
	return ""
}

// AddRule validates and registers a rule. If a rule with the same PanelID exists,
// it is safely replaced without tearing down unrelated subscriptions.
func (e *Engine) AddRule(rule *Rule) error {
	if rule == nil {
		return fmt.Errorf("rule cannot be nil")
	}
	if err := ValidateRule(rule); err != nil {
		return err
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	if e.stopped {
		return fmt.Errorf("engine is stopped")
	}

	ruleCopy := *rule
	pid := rule.PanelID

	// If updating an existing rule, teardown existing timers and subscriptions
	if oldRule, exists := e.rules[pid]; exists {
		e.teardownRuleLocked(oldRule)
	}

	// Preserve prior fireCount and lastFired if available
	st, exists := e.ruleStates[pid]
	if !exists {
		st = &ruleState{}
		e.ruleStates[pid] = st
	} else {
		// Reset transient matching state on edit
		if st.timer != nil {
			st.timer.Stop()
			st.timer = nil
		}
		st.lastMatched = false
		st.hits = nil
		st.trueSince = time.Time{}
		st.sustainedFired = false
		st.tripped = false
		st.trippedReason = ""
	}

	e.rules[pid] = &ruleCopy

	if ruleCopy.Enabled {
		e.setupRuleSubscriptionsLocked(&ruleCopy)
		e.evaluateInitialStateLocked(&ruleCopy, st)
	}

	return nil
}

// RemoveRule deletes a rule and stops any active timer or subscription.
func (e *Engine) RemoveRule(panelID string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	rule, exists := e.rules[panelID]
	if !exists {
		return
	}

	e.teardownRuleLocked(rule)
	delete(e.rules, panelID)
	delete(e.ruleStates, panelID)
}

// ToggleRule enables or disables an existing rule.
func (e *Engine) ToggleRule(panelID string, enabled bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	rule, exists := e.rules[panelID]
	if !exists {
		return fmt.Errorf("rule %q not found", panelID)
	}

	if rule.Enabled == enabled {
		return nil
	}

	rule.Enabled = enabled
	st := e.ruleStates[panelID]

	if !enabled {
		e.teardownRuleLocked(rule)
		if st != nil {
			st.lastMatched = false
			st.hits = nil
			st.trueSince = time.Time{}
			st.sustainedFired = false
		}
	} else {
		if st != nil {
			st.tripped = false
			st.trippedReason = ""
			st.lastMatched = false
			st.hits = nil
			st.trueSince = time.Time{}
			st.sustainedFired = false
		}
		e.setupRuleSubscriptionsLocked(rule)
		if st != nil {
			e.evaluateInitialStateLocked(rule, st)
		}
	}

	return nil
}

// GetRule returns a copy of the registered rule.
func (e *Engine) GetRule(panelID string) (*Rule, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	rule, ok := e.rules[panelID]
	if !ok {
		return nil, false
	}
	cp := *rule
	return &cp, true
}

// GetStatus returns the current observable status for a rule.
func (e *Engine) GetStatus(panelID string) (*RuleStatus, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	rule, ok := e.rules[panelID]
	if !ok {
		return nil, false
	}
	st := e.ruleStates[panelID]
	now := e.now()

	status := &RuleStatus{
		PanelID:      panelID,
		Enabled:      rule.Enabled,
		CurrentState: "idle",
	}

	if st != nil {
		status.FireCount = st.fireCount
		if !st.lastFired.IsZero() {
			lf := st.lastFired
			status.LastFired = &lf
		}

		if st.tripped {
			status.CurrentState = "tripped"
		} else if !rule.Enabled {
			status.CurrentState = "idle"
		} else if rule.CooldownSec > 0 && !st.lastFired.IsZero() && now.Sub(st.lastFired) < time.Duration(rule.CooldownSec)*time.Second {
			remaining := int(math.Ceil((time.Duration(rule.CooldownSec)*time.Second - now.Sub(st.lastFired)).Seconds()))
			status.CurrentState = fmt.Sprintf("cooling down %ds", remaining)
		} else if rule.Mode == "sustained" && st.sustainedFired {
			status.CurrentState = "fired"
		} else if rule.Mode == "sustained" && !st.trueSince.IsZero() && !st.sustainedFired {
			elapsed := int(now.Sub(st.trueSince).Seconds())
			targetSec := rule.SustainedSec
			if targetSec <= 0 {
				targetSec = 10
			}
			status.CurrentState = fmt.Sprintf("true for %ds / %ds", elapsed, targetSec)
		} else if rule.Mode == "count" && len(st.hits) > 0 {
			reqCount := rule.Count
			if reqCount <= 0 {
				reqCount = 5
			}
			status.CurrentState = fmt.Sprintf("waiting %d/%d", len(st.hits), reqCount)
		}
	}

	return status, true
}

// Stop shuts down the engine and clears all timers and subscriptions.
func (e *Engine) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.stopped = true
	for _, st := range e.ruleStates {
		if st.timer != nil {
			st.timer.Stop()
			st.timer = nil
		}
	}

	if e.broker != nil {
		for bt, handler := range e.topicHandlers {
			e.broker.Unsubscribe(bt.brokerID, bt.topic, handler)
		}
	}

	e.topicHandlers = make(map[brokerTopic]mqttclient.MessageHandler)
	e.topicRules = make(map[brokerTopic]map[string]struct{})
	e.guardSubs = make(map[brokerTopic]map[string]struct{})
	e.guardCache = make(map[string]map[string]string)
}

// setupRuleSubscriptionsLocked subscribes to all trigger topics across conditions.
func (e *Engine) setupRuleSubscriptionsLocked(rule *Rule) {
	ruleBrokerID := e.effectiveBroker(rule.BrokerID)

	seenBT := make(map[brokerTopic]bool)
	if strings.TrimSpace(rule.SourceTopic) != "" {
		seenBT[brokerTopic{brokerID: ruleBrokerID, topic: strings.TrimSpace(rule.SourceTopic)}] = true
	}

	for _, c := range rule.Conditions {
		condBrokerID := c.BrokerID
		if condBrokerID == "" {
			condBrokerID = ruleBrokerID
		} else {
			condBrokerID = e.effectiveBroker(condBrokerID)
		}
		top := strings.TrimSpace(c.Topic)
		if top == "" {
			top = strings.TrimSpace(rule.SourceTopic)
		}
		if top != "" {
			seenBT[brokerTopic{brokerID: condBrokerID, topic: top}] = true
		}
	}

	for bt := range seenBT {
		if e.topicRules[bt] == nil {
			e.topicRules[bt] = make(map[string]struct{})
		}
		e.topicRules[bt][rule.PanelID] = struct{}{}

		if _, hasHandler := e.topicHandlers[bt]; !hasHandler {
			h := e.buildTriggerHandler(bt.brokerID, bt.topic)
			e.topicHandlers[bt] = h
			if e.broker != nil {
				if err := e.broker.Subscribe(bt.brokerID, bt.topic, h); err != nil {
					slog.Error("logic engine subscribe trigger error", "broker_id", bt.brokerID, "topic", bt.topic, "err", err)
				}
			}
		}
	}
}

// teardownRuleLocked unregisters the rule from subscription tables and stops timers.
func (e *Engine) teardownRuleLocked(rule *Rule) {
	pid := rule.PanelID
	ruleBrokerID := e.effectiveBroker(rule.BrokerID)

	if st, ok := e.ruleStates[pid]; ok && st.timer != nil {
		st.timer.Stop()
		st.timer = nil
	}

	seenBT := make(map[brokerTopic]bool)
	if strings.TrimSpace(rule.SourceTopic) != "" {
		seenBT[brokerTopic{brokerID: ruleBrokerID, topic: strings.TrimSpace(rule.SourceTopic)}] = true
	}
	for _, c := range rule.Conditions {
		condBrokerID := c.BrokerID
		if condBrokerID == "" {
			condBrokerID = ruleBrokerID
		} else {
			condBrokerID = e.effectiveBroker(condBrokerID)
		}
		top := strings.TrimSpace(c.Topic)
		if top == "" {
			top = strings.TrimSpace(rule.SourceTopic)
		}
		if top != "" {
			seenBT[brokerTopic{brokerID: condBrokerID, topic: top}] = true
		}
	}

	for bt := range seenBT {
		if pids, ok := e.topicRules[bt]; ok {
			delete(pids, pid)
			if len(pids) == 0 {
				delete(e.topicRules, bt)
				if h, hasHandler := e.topicHandlers[bt]; hasHandler {
					delete(e.topicHandlers, bt)
					if e.broker != nil {
						e.broker.Unsubscribe(bt.brokerID, bt.topic, h)
					}
				}
			}
		}
	}
}

func (e *Engine) setGuardValueLocked(brokerID, topic, payload string) {
	effective := e.effectiveBroker(brokerID)
	if e.guardCache[effective] == nil {
		e.guardCache[effective] = make(map[string]string)
	}
	e.guardCache[effective][topic] = payload
}

func (e *Engine) guardLookupLocked() GuardLookup {
	return func(brokerID, topic string) (string, bool) {
		effective := e.effectiveBroker(brokerID)
		cache := e.guardCache[effective]
		if cache == nil {
			return "", false
		}
		val, ok := cache[topic]
		return val, ok
	}
}

// buildGuardHandler builds a stable message handler for guard-only topic updates.
func (e *Engine) buildGuardHandler(brokerID, topic string) mqttclient.MessageHandler {
	return func(msgTopic string, payload []byte, qos byte, retained bool, sourcePanelID string) {
		e.mu.Lock()
		e.setGuardValueLocked(brokerID, msgTopic, string(payload))
		e.mu.Unlock()
	}
}

// buildTriggerHandler builds a stable message handler for trigger topic updates.
func (e *Engine) buildTriggerHandler(brokerID, filter string) mqttclient.MessageHandler {
	key := brokerTopic{brokerID: brokerID, topic: filter}

	return func(msgTopic string, payload []byte, qos byte, retained bool, sourcePanelID string) {
		e.mu.Lock()
		defer e.mu.Unlock()

		// Always update guard cache with incoming message
		e.setGuardValueLocked(brokerID, msgTopic, string(payload))

		pids, ok := e.topicRules[key]
		if !ok || len(pids) == 0 {
			return
		}

		now := e.now()
		msg := Message{
			BrokerID:      brokerID,
			Topic:         msgTopic,
			Payload:       payload,
			QoS:           qos,
			Retained:      retained,
			SourcePanelID: sourcePanelID,
		}
		guardLookup := e.guardLookupLocked()

		for pid := range pids {
			rule, hasRule := e.rules[pid]
			st, hasState := e.ruleStates[pid]
			if !hasRule || !hasState || !rule.Enabled || st.tripped {
				continue
			}

			action := evaluate(rule, st, msg, guardLookup, now)

			// Sustained mode timer arming
			if rule.Mode == "sustained" {
				if st.lastMatched && st.timer == nil && !st.sustainedFired {
					sec := rule.SustainedSec
					if sec <= 0 {
						sec = 10
					}
					panelID := rule.PanelID
					st.timer = time.AfterFunc(time.Duration(sec)*time.Second, func() {
						e.onSustainedTimer(panelID)
					})
				}
			}

			if action != nil {
				e.tryFireActionLocked(rule, st, action, now)
			}
		}
	}
}

// tryFireActionLocked checks cooldown and rate limit ceiling before firing.
func (e *Engine) tryFireActionLocked(rule *Rule, st *ruleState, action *Action, now time.Time) {
	// Cooldown suppression
	if rule.CooldownSec > 0 && !st.lastFired.IsZero() && now.Sub(st.lastFired) < time.Duration(rule.CooldownSec)*time.Second {
		return
	}

	// 10 fires/sec hard rate ceiling
	oneSecAgo := now.Add(-1 * time.Second)
	validTimestamps := st.fireTimestamps[:0]
	for _, ts := range st.fireTimestamps {
		if ts.After(oneSecAgo) {
			validTimestamps = append(validTimestamps, ts)
		}
	}
	st.fireTimestamps = validTimestamps

	if len(st.fireTimestamps) >= 10 {
		// Ceiling reached -> trip rule and disable it
		st.tripped = true
		st.trippedReason = "rate ceiling exceeded: 10 fires/sec"
		rule.Enabled = false
		if st.timer != nil {
			st.timer.Stop()
			st.timer = nil
		}
		slog.Warn("logic rule tripped due to fire ceiling", "panel_id", rule.PanelID, "topic", rule.SourceTopic)
		return
	}

	st.fireTimestamps = append(st.fireTimestamps, now)
	st.lastFired = now
	st.fireCount++

	// Publish on its own goroutine to avoid stalling paho loop
	panelID := rule.PanelID
	go e.executeAction(panelID, action)
}

// onSustainedTimer fires when a rule condition was sustained for the required duration.
func (e *Engine) onSustainedTimer(panelID string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	rule, hasRule := e.rules[panelID]
	st, hasState := e.ruleStates[panelID]
	if !hasRule || !hasState || !rule.Enabled || rule.Mode != "sustained" || st.tripped {
		return
	}

	if st.sustainedFired || st.trueSince.IsZero() {
		return
	}

	st.sustainedFired = true
	st.timer = nil
	now := e.now()

	action := buildAction(rule, st.lastTriggerMsg)
	e.tryFireActionLocked(rule, st, action, now)
}

// executeAction publishes to each comma-separated target topic.
func (e *Engine) executeAction(panelID string, action *Action) {
	if action == nil || e.broker == nil {
		return
	}

	targetBroker := e.effectiveBroker(action.TargetBrokerID)
	targets := strings.Split(action.TargetTopic, ",")
	for _, t := range targets {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if err := e.broker.Publish(targetBroker, t, action.QoS, action.Retain, action.Payload, panelID); err != nil {
			slog.Error("logic engine publish error", "panel_id", panelID, "broker_id", targetBroker, "topic", t, "err", err)
		}
	}
}

// PrimeCache seeds the engine's guard and value cache for a broker topic.
func (e *Engine) PrimeCache(brokerID, topic, payload string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.setGuardValueLocked(brokerID, topic, payload)
}

// evaluateInitialStateLocked evaluates the rule against cached topic payloads if available.
func (e *Engine) evaluateInitialStateLocked(rule *Rule, st *ruleState) {
	if !rule.Enabled || st.tripped {
		return
	}
	ruleBrokerID := e.effectiveBroker(rule.BrokerID)
	top := strings.TrimSpace(rule.SourceTopic)
	if top == "" && len(rule.Conditions) > 0 {
		top = strings.TrimSpace(rule.Conditions[0].Topic)
	}
	cache := e.guardCache[ruleBrokerID]
	if cache == nil {
		return
	}
	payload, ok := cache[top]
	if !ok {
		return
	}
	now := e.now()
	msg := Message{BrokerID: ruleBrokerID, Topic: top, Payload: []byte(payload)}
	guardLookup := e.guardLookupLocked()
	_ = evaluate(rule, st, msg, guardLookup, now)

	if rule.Mode == "sustained" {
		if st.lastMatched && st.timer == nil && !st.sustainedFired {
			sec := rule.SustainedSec
			if sec <= 0 {
				sec = 10
			}
			panelID := rule.PanelID
			st.timer = time.AfterFunc(time.Duration(sec)*time.Second, func() {
				e.onSustainedTimer(panelID)
			})
		}
	}
}

