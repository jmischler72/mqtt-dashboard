package logic

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"mqtt-dashboard/mqtt"
)

// ruleState tracks dynamic execution state for a registered rule.
type ruleState struct {
	lastMatched    bool
	hits           []time.Time
	trueSince      time.Time
	sustainedFired bool
	timer          *time.Timer
	lastFired      time.Time
	fireCount      int
	tripped        bool
	trippedReason  string
	fireTimestamps []time.Time // ring buffer of fires in last 1 second for rate limit
	lastTriggerMsg Message     // latest matching trigger message, for templating
}

// ValidateRule verifies the rule structure and returns an error if invalid.
func ValidateRule(r *Rule) error {
	if strings.TrimSpace(r.SourceTopic) == "" {
		if len(r.Conditions) > 0 && strings.TrimSpace(r.Conditions[0].Topic) != "" {
			r.SourceTopic = strings.TrimSpace(r.Conditions[0].Topic)
		} else {
			return fmt.Errorf("source_topic is required (or condition 1 must have a topic)")
		}
	}
	targetTopic := strings.TrimSpace(r.TargetTopic)
	if targetTopic == "" {
		return fmt.Errorf("target_topic is required")
	}

	targets := strings.Split(targetTopic, ",")
	validTargets := 0
	for _, t := range targets {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		validTargets++
		if mqtt.HasWildcard(t) {
			return fmt.Errorf("cannot publish to wildcard topics (+ or #)")
		}
		// Infinite loop guard: if target broker is same as source/condition broker,
		// target topic must not match any condition topic filter.
		sameBroker := r.TargetBrokerID == r.BrokerID || r.TargetBrokerID == "" || r.BrokerID == ""
		if sameBroker && mqtt.TopicMatches(r.SourceTopic, t) {
			return fmt.Errorf("target topic %q matches source topic %q (infinite loop prevention)", t, r.SourceTopic)
		}
		for _, c := range r.Conditions {
			cTopic := strings.TrimSpace(c.Topic)
			if cTopic == "" {
				cTopic = r.SourceTopic
			}
			cBroker := c.BrokerID
			if cBroker == "" {
				cBroker = r.BrokerID
			}
			sameCondBroker := r.TargetBrokerID == cBroker || r.TargetBrokerID == "" || cBroker == ""
			if sameCondBroker && mqtt.TopicMatches(cTopic, t) {
				return fmt.Errorf("target topic %q matches condition topic %q (infinite loop prevention)", t, cTopic)
			}
		}
	}
	if validTargets == 0 {
		return fmt.Errorf("target_topic must contain at least one valid topic")
	}

	for i, c := range r.Conditions {
		if c.Join != "" && c.Join != "and" && c.Join != "or" {
			return fmt.Errorf("condition %d: join must be 'and' or 'or', got %q", i, c.Join)
		}
		switch c.Operator {
		case "any", "exists", "eq", "ne", "contains":
			// valid
		case "gt", "lt", "gte", "lte":
			if _, err := strconv.ParseFloat(strings.TrimSpace(c.Value), 64); err != nil {
				return fmt.Errorf("condition %d: numeric operator %q requires a numeric value, got %q", i, c.Operator, c.Value)
			}
		default:
			return fmt.Errorf("condition %d: unknown operator %q", i, c.Operator)
		}
	}

	if r.Mode != "" {
		switch r.Mode {
		case "every", "on_change", "count", "sustained":
		default:
			return fmt.Errorf("invalid mode %q", r.Mode)
		}
	}

	if r.CooldownSec < 0 {
		return fmt.Errorf("cooldown_sec cannot be negative")
	}

	return nil
}

// resolveJSONPath resolves dot-notation or bracket path within a JSON payload.
func resolveJSONPath(payload []byte, path string) (string, bool) {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return string(payload), true
	}
	if len(payload) == 0 {
		return "", false
	}

	var root any
	if err := json.Unmarshal(payload, &root); err != nil {
		return "", false
	}

	// Normalize foo[0].bar -> foo.0.bar
	normalized := strings.ReplaceAll(trimmedPath, "[", ".")
	normalized = strings.ReplaceAll(normalized, "]", "")
	segments := strings.Split(normalized, ".")

	curr := root
	for _, seg := range segments {
		seg = strings.TrimSpace(seg)
		if seg == "" {
			continue
		}

		if curr == nil {
			return "", false
		}

		switch obj := curr.(type) {
		case map[string]any:
			val, exists := obj[seg]
			if !exists {
				return "", false
			}
			curr = val
		case []any:
			idx, err := strconv.Atoi(seg)
			if err != nil || idx < 0 || idx >= len(obj) {
				return "", false
			}
			curr = obj[idx]
		default:
			return "", false
		}
	}

	switch v := curr.(type) {
	case nil:
		return "null", true
	case string:
		return v, true
	case bool:
		if v {
			return "true", true
		}
		return "false", true
	case float64:
		if v == math.Trunc(v) && !math.IsNaN(v) && !math.IsInf(v, 0) {
			return strconv.FormatInt(int64(v), 10), true
		}
		return strconv.FormatFloat(v, 'f', -1, 64), true
	default:
		bytes, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprint(v), true
		}
		return string(bytes), true
	}
}

const tokenSentinel = "__mqtt_dashboard_token__"

// deriveJSONPath derives the dot-notation path to the "{value}" token in a JSON template.
func deriveJSONPath(template string) (string, bool) {
	if !strings.Contains(template, "{value}") {
		return "", false
	}

	idx := strings.Index(template, "{value}")
	isQuoted := idx > 0 && idx+7 < len(template) && template[idx-1] == '"' && template[idx+7] == '"'

	var parseable string
	if isQuoted {
		parseable = strings.Replace(template, "{value}", tokenSentinel, 1)
	} else {
		parseable = strings.Replace(template, "{value}", fmt.Sprintf("%q", tokenSentinel), 1)
	}

	var root any
	if err := json.Unmarshal([]byte(parseable), &root); err != nil {
		return "", false
	}

	var findPath func(node any, prefix string) (string, bool)
	findPath = func(node any, prefix string) (string, bool) {
		if s, ok := node.(string); ok && s == tokenSentinel {
			return prefix, true
		}
		switch obj := node.(type) {
		case map[string]any:
			for k, v := range obj {
				nextPrefix := k
				if prefix != "" {
					nextPrefix = prefix + "." + k
				}
				if path, found := findPath(v, nextPrefix); found {
					return path, true
				}
			}
		case []any:
			for i, v := range obj {
				nextPrefix := strconv.Itoa(i)
				if prefix != "" {
					nextPrefix = prefix + "." + nextPrefix
				}
				if path, found := findPath(v, nextPrefix); found {
					return path, true
				}
			}
		}
		return "", false
	}

	return findPath(root, "")
}

// matchTemplateStencil extracts the value by matching prefix and suffix text around "{value}".
func matchTemplateStencil(template, raw string) (string, bool) {
	idx := strings.Index(template, "{value}")
	if idx == -1 {
		return "", false
	}
	prefix := template[:idx]
	suffix := template[idx+len("{value}"):]

	trimmedRaw := strings.TrimSpace(raw)
	trimmedPrefix := strings.TrimSpace(prefix)
	trimmedSuffix := strings.TrimSpace(suffix)

	if strings.HasPrefix(trimmedRaw, trimmedPrefix) && strings.HasSuffix(trimmedRaw, trimmedSuffix) {
		middle := trimmedRaw[len(trimmedPrefix) : len(trimmedRaw)-len(trimmedSuffix)]
		middle = strings.TrimSpace(middle)
		if len(middle) >= 2 && middle[0] == '"' && middle[len(middle)-1] == '"' {
			middle = middle[1 : len(middle)-1]
		}
		return middle, true
	}
	return "", false
}

// extractValueFromPayload extracts the targeted value from a raw payload using either a JSON path
// or a read template (e.g. `{"temp":{value}}`).
func extractValueFromPayload(raw string, jsonPath, readTemplate string) (string, bool) {
	cleanTmpl := strings.TrimSpace(readTemplate)
	cleanPath := strings.TrimSpace(jsonPath)

	if (cleanTmpl == "" || cleanTmpl == "{value}") && cleanPath == "" {
		return raw, true
	}

	if cleanPath != "" {
		if extracted, ok := resolveJSONPath([]byte(raw), cleanPath); ok {
			return extracted, true
		}
	}

	if cleanTmpl != "" && cleanTmpl != "{value}" {
		if cleanPath == "" {
			if derivedPath, ok := deriveJSONPath(cleanTmpl); ok && derivedPath != "" {
				if extracted, ok := resolveJSONPath([]byte(raw), derivedPath); ok {
					return extracted, true
				}
			}
		}

		if extracted, ok := matchTemplateStencil(cleanTmpl, raw); ok {
			return extracted, true
		}
	}

	// If the payload is a composite JSON object/array, but target field/stencil was not found,
	// fail closed.
	var root any
	if err := json.Unmarshal([]byte(raw), &root); err == nil {
		switch v := root.(type) {
		case map[string]any, []any:
			return "", false
		case string:
			return v, true
		case float64:
			if v == math.Trunc(v) && !math.IsNaN(v) && !math.IsInf(v, 0) {
				return strconv.FormatInt(int64(v), 10), true
			}
			return strconv.FormatFloat(v, 'f', -1, 64), true
		case bool:
			if v {
				return "true", true
			}
			return "false", true
		default:
			return strings.TrimSpace(raw), true
		}
	}

	// Payload is non-JSON raw scalar (e.g. bare "ON", "OFF", "40")
	return strings.TrimSpace(raw), true
}

// evaluateCondition checks whether a single condition holds true.
func evaluateCondition(c Condition, ruleBrokerID string, msg Message, guards GuardLookup) bool {
	condBrokerID := c.BrokerID
	if condBrokerID == "" {
		condBrokerID = ruleBrokerID
	}
	condTopic := strings.TrimSpace(c.Topic)

	var raw string
	var exists bool

	brokerMatches := (condBrokerID == msg.BrokerID) || (condBrokerID == "" && msg.BrokerID != "") || (condBrokerID != "" && msg.BrokerID == "")
	if (condTopic == "" || condTopic == msg.Topic || mqtt.TopicMatches(condTopic, msg.Topic)) && brokerMatches {
		raw = string(msg.Payload)
		exists = true
	} else {
		if guards == nil {
			return false
		}
		targetTopic := condTopic
		if targetTopic == "" {
			targetTopic = msg.Topic
		}
		raw, exists = guards(condBrokerID, targetTopic)
		if !exists {
			return false // guard topic has not published yet -> fail closed
		}
	}

	targetVal, found := extractValueFromPayload(raw, c.JSONPath, c.ReadTemplate)

	if c.Operator == "exists" {
		if strings.TrimSpace(c.JSONPath) != "" || (strings.TrimSpace(c.ReadTemplate) != "" && c.ReadTemplate != "{value}") {
			return found
		}
		return exists && len(raw) > 0
	}

	if !found {
		return false // field / template not found -> fail closed
	}

	switch c.Operator {
	case "any":
		return true

	case "eq":
		fTarget, err1 := strconv.ParseFloat(targetVal, 64)
		fVal, err2 := strconv.ParseFloat(c.Value, 64)
		if err1 == nil && err2 == nil {
			return fTarget == fVal
		}
		return targetVal == c.Value

	case "ne":
		fTarget, err1 := strconv.ParseFloat(targetVal, 64)
		fVal, err2 := strconv.ParseFloat(c.Value, 64)
		if err1 == nil && err2 == nil {
			return fTarget != fVal
		}
		return targetVal != c.Value

	case "gt":
		fTarget, err1 := strconv.ParseFloat(targetVal, 64)
		fVal, err2 := strconv.ParseFloat(c.Value, 64)
		if err1 != nil || err2 != nil {
			return false // non-numeric -> fail closed
		}
		return fTarget > fVal

	case "lt":
		fTarget, err1 := strconv.ParseFloat(targetVal, 64)
		fVal, err2 := strconv.ParseFloat(c.Value, 64)
		if err1 != nil || err2 != nil {
			return false
		}
		return fTarget < fVal

	case "gte":
		fTarget, err1 := strconv.ParseFloat(targetVal, 64)
		fVal, err2 := strconv.ParseFloat(c.Value, 64)
		if err1 != nil || err2 != nil {
			return false
		}
		return fTarget >= fVal

	case "lte":
		fTarget, err1 := strconv.ParseFloat(targetVal, 64)
		fVal, err2 := strconv.ParseFloat(c.Value, 64)
		if err1 != nil || err2 != nil {
			return false
		}
		return fTarget <= fVal

	case "contains":
		return strings.Contains(targetVal, c.Value)

	default:
		return false
	}
}

// evaluateRuleConditions checks all conditions of a rule, respecting sequential Join or Match fallback.
func evaluateRuleConditions(r *Rule, msg Message, guards GuardLookup) bool {
	if len(r.Conditions) == 0 {
		return true
	}

	hasExplicitJoin := false
	for i := 1; i < len(r.Conditions); i++ {
		if r.Conditions[i].Join != "" {
			hasExplicitJoin = true
			break
		}
	}

	if !hasExplicitJoin && r.Match != "" {
		if r.Match == "any" {
			for _, c := range r.Conditions {
				if evaluateCondition(c, r.BrokerID, msg, guards) {
					return true
				}
			}
			return false
		}
		for _, c := range r.Conditions {
			if !evaluateCondition(c, r.BrokerID, msg, guards) {
				return false
			}
		}
		return true
	}

	matched := evaluateCondition(r.Conditions[0], r.BrokerID, msg, guards)
	for i := 1; i < len(r.Conditions); i++ {
		c := r.Conditions[i]
		cMatched := evaluateCondition(c, r.BrokerID, msg, guards)
		if strings.ToLower(c.Join) == "or" {
			matched = matched || cMatched
		} else {
			matched = matched && cMatched
		}
	}
	return matched
}

// buildAction constructs the Action to be published, applying payload template tokens.
func buildAction(r *Rule, msg Message) *Action {
	targetBroker := r.TargetBrokerID
	if targetBroker == "" {
		targetBroker = r.BrokerID
	}

	payload := r.Payload
	triggerVal := string(msg.Payload)
	if len(r.Conditions) > 0 {
		c0 := r.Conditions[0]
		condBroker := c0.BrokerID
		if condBroker == "" {
			condBroker = r.BrokerID
		}
		condTopic := strings.TrimSpace(c0.Topic)
		brokerMatches := (condBroker == msg.BrokerID) || (condBroker == "" && msg.BrokerID != "") || (condBroker != "" && msg.BrokerID == "")
		if (condTopic == "" || condTopic == msg.Topic || mqtt.TopicMatches(condTopic, msg.Topic)) && brokerMatches {
			if v, ok := extractValueFromPayload(triggerVal, c0.JSONPath, c0.ReadTemplate); ok {
				triggerVal = v
			}
		}
	}

	payload = strings.ReplaceAll(payload, "{{value}}", triggerVal)

	return &Action{
		TargetBrokerID: targetBroker,
		TargetTopic:    r.TargetTopic,
		Payload:        []byte(payload),
		QoS:            r.QoS,
		Retain:         r.Retain,
	}
}

// evaluate evaluates the rule against the incoming message and current state.
// It is pure logic: no network calls, no timers started, no clock reads beyond now.
func evaluate(r *Rule, st *ruleState, msg Message, guards GuardLookup, now time.Time) *Action {
	if st.tripped {
		return nil
	}

	matched := evaluateRuleConditions(r, msg, guards)

	mode := r.Mode
	if mode == "" {
		mode = "on_change"
	}

	switch mode {
	case "every":
		st.lastMatched = matched
		if matched {
			return buildAction(r, msg)
		}
		return nil

	case "on_change":
		fire := matched && !st.lastMatched
		st.lastMatched = matched
		if fire {
			return buildAction(r, msg)
		}
		return nil

	case "count":
		st.lastMatched = matched
		if !matched {
			return nil
		}
		st.hits = append(st.hits, now)
		windowSec := r.WindowSec
		if windowSec <= 0 {
			windowSec = 60
		}
		cutoff := now.Add(-time.Duration(windowSec) * time.Second)
		validHits := st.hits[:0]
		for _, h := range st.hits {
			if h.After(cutoff) {
				validHits = append(validHits, h)
			}
		}
		st.hits = validHits

		reqCount := r.Count
		if reqCount <= 0 {
			reqCount = 5
		}
		if len(st.hits) >= reqCount {
			st.hits = nil // reset hit buffer
			return buildAction(r, msg)
		}
		return nil

	case "sustained":
		st.lastMatched = matched
		if !matched {
			if st.timer != nil {
				st.timer.Stop()
				st.timer = nil
			}
			st.trueSince = time.Time{}
			st.sustainedFired = false
			return nil
		}
		// Condition is true: update latest message and start tracking if needed
		st.lastTriggerMsg = msg
		if st.trueSince.IsZero() {
			st.trueSince = now
			st.sustainedFired = false
		}
		return nil // Sustained mode action will be produced asynchronously by the timer callback
	}

	return nil
}
