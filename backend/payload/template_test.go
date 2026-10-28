package payload

import (
	"testing"
	"time"
)

func TestInterpolate(t *testing.T) {
	fixedTime := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	ctx := Context{
		Value:     "42",
		Topic:     "sensors/kitchen/temp",
		Payload:   `{"temp":42}`,
		Timestamp: fixedTime,
		ConditionValues: map[string]string{
			"1": "42",
			"2": "65",
		},
	}

	tests := []struct {
		name     string
		template string
		expected string
	}{
		{
			name:     "canonical single brace tokens",
			template: `{"val":{value},"t":"{topic}","raw":'{payload}'}`,
			expected: `{"val":42,"t":"sensors/kitchen/temp","raw":'{"temp":42}'}`,
		},
		{
			name:     "legacy double brace tokens",
			template: `{"val":{{value}},"t":"{{topic}}","raw":'{{payload}}'}`,
			expected: `{"val":42,"t":"sensors/kitchen/temp","raw":'{"temp":42}'}`,
		},
		{
			name:     "timestamp tokens",
			template: `{"ts":{timestamp},"ms":{timestamp:ms},"iso":"{timestamp:iso}","iso2":"{iso_timestamp}"}`,
			expected: `{"ts":1792929600,"ms":1792929600000,"iso":"2026-10-25T12:00:00Z","iso2":"2026-10-25T12:00:00Z"}`,
		},
		{
			name:     "condition indexing",
			template: `{"temp":{value:1},"hum":{{value:2}}}`,
			expected: `{"temp":42,"hum":65}`,
		},
		{
			name:     "non-token JSON braces untouched",
			template: `{"device":{"name":"test"},"reading":{value}}`,
			expected: `{"device":{"name":"test"},"reading":42}`,
		},
		{
			name:     "empty template",
			template: "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Interpolate(tt.template, ctx)
			if got != tt.expected {
				t.Errorf("Interpolate(%q) = %q; want %q", tt.template, got, tt.expected)
			}
		})
	}
}
