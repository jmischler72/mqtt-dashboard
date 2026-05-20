package mqtt

import "strings"

// TopicMatches reports whether a concrete topic matches an MQTT filter pattern.
// Supports single-level wildcard '+' and multi-level wildcard '#'.
// Per MQTT spec, '#' does not match topics that begin with '$' (e.g. $SYS/…).
func TopicMatches(filter, topic string) bool {
	// Bare '#' must not match reserved '$' topics.
	if !strings.HasPrefix(filter, "$") && strings.HasPrefix(topic, "$") {
		return false
	}

	fp := strings.Split(filter, "/")
	tp := strings.Split(topic, "/")

	for i, seg := range fp {
		switch seg {
		case "#":
			return true // matches zero or more remaining levels
		case "+":
			if i >= len(tp) {
				return false
			}
			// '+' matches exactly one level — continue to next segment
		default:
			if i >= len(tp) || seg != tp[i] {
				return false
			}
		}
	}
	return len(fp) == len(tp)
}

// HasWildcard reports whether a filter contains any MQTT wildcard characters.
func HasWildcard(filter string) bool {
	return strings.ContainsAny(filter, "+#")
}

// ToSQLLikePattern converts an MQTT filter to a SQL LIKE pattern that is a
// superset of the matching topics. The result may over-select; callers should
// apply TopicMatches for precise Go-level filtering afterwards.
//
// Examples:
//
//	"sensors/#"      → "sensors/%"
//	"home/+/status"  → "home/%"
//	"#"              → "%"
//	"+"              → "%"
func ToSQLLikePattern(filter string) string {
	idx := strings.IndexAny(filter, "+#")
	if idx < 0 {
		return filter // no wildcards
	}
	prefix := strings.TrimSuffix(filter[:idx], "/")
	if prefix == "" {
		return "%"
	}
	return prefix + "/%"
}
