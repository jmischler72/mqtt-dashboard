package payload

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Context provides values for token interpolation in payload templates.
type Context struct {
	Value             string
	Topic             string
	Payload           string
	Timestamp         time.Time
	ConditionValues   map[string]string // e.g. "0": val, "1": val, "sensors/temp": val
	ConditionPayloads map[string]string // e.g. "0": raw, "1": raw, "sensors/temp": raw
}

// TokenPattern matches both single-brace canonical tokens ({value}, {topic}, {payload}, {timestamp},
// {value:0}, {value:sensors/temp}, etc.) and legacy double-brace tokens ({{value}}, {{topic}}, etc.).
// Normal JSON object braces (like {"key": "val"}) do not match because keys/contents contain quotes, spaces, etc.
var tokenRegex = regexp.MustCompile(`\{\{(?:value(?::[a-zA-Z0-9_/.-]+)?|topic|payload(?::[a-zA-Z0-9_/.-]+)?|timestamp(?::(?:ms|iso))?|iso_timestamp)\}\}|\{(?:value(?::[a-zA-Z0-9_/.-]+)?|topic|payload(?::[a-zA-Z0-9_/.-]+)?|timestamp(?::(?:ms|iso))?|iso_timestamp)\}`)

// Interpolate substitutes context tokens into template.
// Supports both single-brace canonical tokens ({value}, {topic}, {payload}, {timestamp})
// and legacy double-brace tokens ({{value}}, {{topic}}, etc.).
func Interpolate(template string, ctx Context) string {
	if template == "" {
		return ""
	}

	ts := ctx.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}

	return tokenRegex.ReplaceAllStringFunc(template, func(match string) string {
		token := match
		if strings.HasPrefix(token, "{{") && strings.HasSuffix(token, "}}") {
			token = token[2 : len(token)-2]
		} else if strings.HasPrefix(token, "{") && strings.HasSuffix(token, "}") {
			token = token[1 : len(token)-1]
		}
		token = strings.TrimSpace(token)

		switch token {
		case "value":
			return ctx.Value
		case "topic":
			return ctx.Topic
		case "payload":
			return ctx.Payload
		case "timestamp":
			return strconv.FormatInt(ts.Unix(), 10)
		case "timestamp:ms":
			return strconv.FormatInt(ts.UnixMilli(), 10)
		case "timestamp:iso", "iso_timestamp":
			return ts.UTC().Format(time.RFC3339)
		default:
			if strings.HasPrefix(token, "value:") {
				key := strings.TrimPrefix(token, "value:")
				if ctx.ConditionValues != nil {
					if val, ok := ctx.ConditionValues[key]; ok {
						return val
					}
				}
				return ""
			}
			if strings.HasPrefix(token, "payload:") {
				key := strings.TrimPrefix(token, "payload:")
				if ctx.ConditionPayloads != nil {
					if val, ok := ctx.ConditionPayloads[key]; ok {
						return val
					}
				}
				return ""
			}
			return match
		}
	})
}
