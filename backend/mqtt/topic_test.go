package mqtt

import "testing"

func TestTopicMatches(t *testing.T) {
	tests := []struct {
		filter string
		topic  string
		want   bool
	}{
		// Exact matches
		{"a/b/c", "a/b/c", true},
		{"a/b/c", "a/b/d", false},
		{"a/b/c", "a/b", false},
		{"a/b", "a/b/c", false},

		// Single-level wildcard '+'
		{"a/+/c", "a/b/c", true},
		{"a/+/c", "a/x/c", true},
		{"a/+/c", "a/b/d", false},
		{"a/+/c", "a/b/c/d", false},
		{"a/+/c", "a/c", false},
		{"+", "a", true},
		{"+", "a/b", false},
		{"a/+", "a/b", true},
		{"a/+", "a/b/c", false},

		// Multi-level wildcard '#'
		{"#", "a", true},
		{"#", "a/b/c", true},
		{"a/#", "a", true},
		{"a/#", "a/b", true},
		{"a/#", "a/b/c", true},
		{"a/#", "b/c", false},
		{"a/b/#", "a/b", true},
		{"a/b/#", "a/b/c", true},
		{"a/b/#", "a/b/c/d", true},
		{"a/b/#", "a/c", false},

		// Mixed
		{"+/+", "a/b", true},
		{"+/+", "a/b/c", false},
		{"a/+/#", "a/b/c/d", true},
		{"a/+/#", "a/b", true},
		{"a/+/#", "a", false},

		// $SYS topics must not match bare '#'
		{"#", "$SYS/broker/version", false},
		{"$SYS/#", "$SYS/broker/version", true},
		{"$SYS/+", "$SYS/broker", true},
		{"$SYS/+", "$SYS/broker/version", false},
	}

	for _, tt := range tests {
		t.Run(tt.filter+"~"+tt.topic, func(t *testing.T) {
			got := TopicMatches(tt.filter, tt.topic)
			if got != tt.want {
				t.Errorf("TopicMatches(%q, %q) = %v, want %v", tt.filter, tt.topic, got, tt.want)
			}
		})
	}
}

func TestHasWildcard(t *testing.T) {
	tests := []struct {
		filter string
		want   bool
	}{
		{"a/b/c", false},
		{"a/#", true},
		{"a/+/c", true},
		{"#", true},
		{"+", true},
		{"$SYS/broker", false},
		{"$SYS/#", true},
	}
	for _, tt := range tests {
		got := HasWildcard(tt.filter)
		if got != tt.want {
			t.Errorf("HasWildcard(%q) = %v, want %v", tt.filter, got, tt.want)
		}
	}
}

func TestToSQLLikePattern(t *testing.T) {
	tests := []struct {
		filter string
		want   string
	}{
		{"sensors/#", "sensors/%"},
		{"home/+/status", "home/%"},
		{"#", "%"},
		{"+", "%"},
		{"a/b/c", "a/b/c"},
		{"a/b/#", "a/b/%"},
		{"a/+/b/#", "a/%"},
		{"$SYS/#", "$SYS/%"},
	}
	for _, tt := range tests {
		got := ToSQLLikePattern(tt.filter)
		if got != tt.want {
			t.Errorf("ToSQLLikePattern(%q) = %q, want %q", tt.filter, got, tt.want)
		}
	}
}
