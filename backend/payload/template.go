package payload

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Context provides values for token interpolation in payload templates.
type Context struct {
	Value           string
	Topic           string
	Payload         string
	Timestamp       time.Time
	ConditionValues map[string]string // 1-indexed condition values: "1": val, "2": val
}

const tokenInnerPattern = `(?:value(?::[0-9]+)?|topic|payload|timestamp(?::(?:ms|iso))?|iso_timestamp)`

// TokenPattern matches both double-brace canonical tokens ({{value}}, {{topic}}, {{payload}}, {{timestamp}},
// {{value:1}}, etc.) and legacy single-brace tokens ({value}, {topic}, etc.).
// Normal JSON object braces (like {"key": "val"}) do not match because keys/contents contain quotes, spaces, etc.
var tokenRegex = regexp.MustCompile(`\{\{\s*` + tokenInnerPattern + `\s*\}\}|\{\s*` + tokenInnerPattern + `\s*\}`)

// Interpolate substitutes context tokens into template.
// Supports both single-brace canonical tokens ({value}, {topic}, {payload}, {timestamp})
// and double-brace tokens ({{value}}, {{topic}}, {{value:1}}, etc.).
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
			return match
		}
	})
}
