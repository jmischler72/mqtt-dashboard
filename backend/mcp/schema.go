package mcp

import (
	"encoding/json"
	"fmt"
	"strings"

	"mqtt-dashboard/models"
)

// PanelTypeSpec describes a supported dashboard panel type and its configuration schema.
type PanelTypeSpec struct {
	Type        string         `json:"type"`
	Category    string         `json:"category"`
	Description string         `json:"description"`
	DefaultW    int            `json:"default_w"`
	DefaultH    int            `json:"default_h"`
	ConfigShape map[string]any `json:"config_shape"`
	Example     map[string]any `json:"example"`
}

// PanelCatalog returns the complete specification of all 13 panel types supported by MQTT Dashboard.
func PanelCatalog() []PanelTypeSpec {
	return []PanelTypeSpec{
		{
			Type:        "gauge",
			Category:    "monitor",
			Description: "Live numeric readout with radial, arc, linear, or digital display and customizable range/units.",
			DefaultW:    3,
			DefaultH:    3,
			ConfigShape: map[string]any{
				"topic":        "string (required) - MQTT topic to subscribe to (no wildcards)",
				"readTemplate": "string (optional) - Stencil or JSON shape with {value}, e.g. '{\"temperature\": {value}}' or '{value}'",
				"valueKey":     "string (optional) - Dot-path into JSON payload, e.g. 'sensor.temperature' (alternative to readTemplate)",
				"unit":         "string (optional) - Display unit, e.g. '°C', '%', 'W', 'hPa'",
				"min":          "number (optional, default 0) - Scale minimum",
				"max":          "number (optional, default 100) - Scale maximum",
				"gaugeType":    "string (optional) - 'radial' | 'semi' | 'linear' | 'digital' (default 'radial')",
				"colorScheme":  "string (optional) - 'auto' | 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'info'",
			},
			Example: map[string]any{
				"topic":        "sensors/greenhouse/climate",
				"readTemplate": `{"temperature": {value}}`,
				"unit":         "°C",
				"min":          0,
				"max":          50,
				"gaugeType":    "radial",
				"colorScheme":  "auto",
			},
		},
		{
			Type:        "graph",
			Category:    "monitor",
			Description: "Real-time time-series line/area chart for one or multiple topics (supports wildcards up to 12 series).",
			DefaultW:    6,
			DefaultH:    4,
			ConfigShape: map[string]any{
				"topics":            "string (required) - Comma-separated topics or wildcard, e.g. 'sensors/+/temperature'",
				"readTemplate":      "string (optional) - Shape with {value} marking numeric value to plot, e.g. '{\"value\": {value}}'",
				"valueKey":          "string (optional) - Dot-path into JSON payload, e.g. 'temperature'",
				"unit":              "string (optional) - Axis/tooltip unit, e.g. '°C'",
				"timeWindowSeconds": "number (optional, default 900) - 60, 300, 900, 1800, 3600, 21600, or 86400",
				"maxPoints":         "number (optional, default 200)",
				"yMin":              "number | null (optional) - Fixed Y-axis minimum",
				"yMax":              "number | null (optional) - Fixed Y-axis maximum",
				"curve":             "string (optional) - 'monotone' | 'linear' | 'step' (default 'monotone')",
				"showArea":          "boolean (optional, default true)",
				"showPoints":        "boolean (optional, default false)",
				"showLegend":        "boolean (optional, default true)",
			},
			Example: map[string]any{
				"topics":            "sensors/+/temperature",
				"readTemplate":      `{"temperature": {value}}`,
				"unit":              "°C",
				"timeWindowSeconds": 900,
				"curve":             "monotone",
				"showArea":          true,
				"showLegend":        true,
			},
		},
		{
			Type:        "stats",
			Category:    "monitor",
			Description: "Message rate throughput chart, message count tiles, and top-topic activity breakdown.",
			DefaultW:    4,
			DefaultH:    3,
			ConfigShape: map[string]any{
				"topic":              "string (optional, default '#') - Topic filter (supports wildcards, e.g. 'sensors/#')",
				"defaultRange":       "number (optional, default 300) - Window in seconds: 60, 300, 900, or 3600",
				"showStatTiles":      "boolean (optional, default true)",
				"showChart":          "boolean (optional, default true)",
				"showTopicBreakdown": "boolean (optional, default false)",
			},
			Example: map[string]any{
				"topic":              "sensors/#",
				"defaultRange":       300,
				"showStatTiles":      true,
				"showChart":          true,
				"showTopicBreakdown": true,
			},
		},
		{
			Type:        "log",
			Category:    "monitor",
			Description: "Live scrolling MQTT message inspector supporting multiple comma-separated topic filters and wildcards.",
			DefaultW:    6,
			DefaultH:    3,
			ConfigShape: map[string]any{
				"topics":       "string (required) - Comma-separated topic filters, e.g. 'home/+/status, alerts/#'",
				"maxMessages":  "number (optional, default 200)",
				"dateFormat":   "string (optional) - 'time' | 'full' | 'relative' (default 'time')",
				"showQos":      "boolean (optional, default true)",
				"showRetained": "boolean (optional, default true)",
				"showSource":   "boolean (optional, default false)",
			},
			Example: map[string]any{
				"topics":       "sensors/#, actuators/#",
				"maxMessages":  200,
				"dateFormat":   "time",
				"showQos":      true,
				"showRetained": true,
			},
		},
		{
			Type:        "button",
			Category:    "control",
			Description: "One-click command publisher with optional confirmation prompt.",
			DefaultW:    2,
			DefaultH:    2,
			ConfigShape: map[string]any{
				"label":          "string (optional) - Button text label, e.g. 'Boost Fan'",
				"topic":          "string (required) - Command topic to publish to (no wildcards)",
				"payload":        "string (optional) - Literal payload to publish (raw string or JSON)",
				"qos":            "number (optional, default 0) - 0, 1, or 2",
				"retain":         "boolean (optional, default false)",
				"requireConfirm": "boolean (optional, default false) - Ask before publishing",
			},
			Example: map[string]any{
				"label":   "Trigger Pump",
				"topic":   "actuators/pump/cmd",
				"payload": `{"action": "pulse", "duration_sec": 10}`,
				"qos":     1,
				"retain":  false,
			},
		},
		{
			Type:        "toggle",
			Category:    "control",
			Description: "Bidirectional ON/OFF switch that publishes commands and reflects live device state.",
			DefaultW:    3,
			DefaultH:    2,
			ConfigShape: map[string]any{
				"topic":           "string (required) - Command topic to publish ON/OFF state",
				"payloadTemplate": "string (optional, default '{value}') - Write template with {value}, e.g. '{\"state\": \"{value}\"}'",
				"onPayload":       "string (optional, default 'ON') - Value substituted into {value} when turning ON",
				"offPayload":      "string (optional, default 'OFF') - Value substituted into {value} when turning OFF",
				"separateRead":    "boolean (optional, default false) - True if state is read from a different topic or shape",
				"stateTopic":      "string (optional) - State telemetry topic when separateRead is true",
				"readTemplate":    "string (optional) - Incoming message shape with {value} when separateRead is true",
				"qos":             "number (optional, default 0)",
				"retain":          "boolean (optional, default false)",
			},
			Example: map[string]any{
				"topic":           "zigbee2mqtt/grow_light/set",
				"payloadTemplate": `{"state": "{value}"}`,
				"onPayload":       "ON",
				"offPayload":      "OFF",
				"separateRead":    true,
				"stateTopic":      "zigbee2mqtt/grow_light",
				"readTemplate":    `{"state": "{value}"}`,
				"qos":             1,
				"retain":          true,
			},
		},
		{
			Type:        "slider",
			Category:    "control",
			Description: "Numeric range slider for dimmers, setpoints, valve positions, or fan speeds.",
			DefaultW:    4,
			DefaultH:    2,
			ConfigShape: map[string]any{
				"topic":           "string (required) - Command topic to publish numeric value",
				"payloadTemplate": "string (optional, default '{value}') - Write template with {value}, e.g. '{\"brightness\": {value}}'",
				"min":             "number (optional, default 0)",
				"max":             "number (optional, default 100)",
				"step":            "number (optional, default 1)",
				"unit":            "string (optional) - Display unit, e.g. '%', '°C'",
				"separateRead":    "boolean (optional, default false)",
				"stateTopic":      "string (optional) - State topic when separateRead is true",
				"readTemplate":    "string (optional) - Read shape with {value} when separateRead is true",
				"qos":             "number (optional, default 0)",
				"retain":          "boolean (optional, default false)",
			},
			Example: map[string]any{
				"topic":           "hvac/thermostat/setpoint/set",
				"payloadTemplate": `{"target_temp": {value}}`,
				"min":             15,
				"max":             30,
				"step":            0.5,
				"unit":            "°C",
				"separateRead":    true,
				"stateTopic":      "hvac/thermostat/state",
				"readTemplate":    `{"target_temp": {value}}`,
			},
		},
		{
			Type:        "input",
			Category:    "control",
			Description: "Free-form text or JSON payload input box for sending custom commands to a topic.",
			DefaultW:    4,
			DefaultH:    2,
			ConfigShape: map[string]any{
				"topic":       "string (required) - Target MQTT topic (no wildcards)",
				"placeholder": "string (optional) - Input placeholder hint",
				"qos":         "number (optional, default 0)",
				"retain":      "boolean (optional, default false)",
			},
			Example: map[string]any{
				"topic":       "device/node-1/cmd",
				"placeholder": "Enter command payload...",
				"qos":         1,
				"retain":      false,
			},
		},
		{
			Type:        "cron",
			Category:    "control",
			Description: "Scheduled recurring MQTT publisher executed by the backend cron scheduler.",
			DefaultW:    3,
			DefaultH:    2,
			ConfigShape: map[string]any{
				"cron_expr": "string (required) - Standard 5-field cron expression, e.g. '*/5 * * * *' or '0 8 * * *'",
				"topic":     "string (required) - Target MQTT topic (no wildcards)",
				"payload":   "string (optional) - Payload to publish on schedule",
				"qos":       "number (optional, default 0)",
				"retain":    "boolean (optional, default false)",
				"enabled":   "boolean (optional, default true)",
			},
			Example: map[string]any{
				"cron_expr": "*/5 * * * *",
				"topic":     "sensors/poll",
				"payload":   `{"cmd": "read_all"}`,
				"qos":       0,
				"retain":    false,
				"enabled":   true,
			},
		},
		{
			Type:        "logic",
			Category:    "control",
			Description: "Reactive automation rule evaluated by the backend logic engine (IF source_topic matches conditions -> publish to target_topic).",
			DefaultW:    4,
			DefaultH:    3,
			ConfigShape: map[string]any{
				"source_topic":  "string (required) - Trigger topic (wildcards allowed, e.g. 'sensors/+/temp')",
				"match":         "string (optional, default 'all') - 'all' (AND) | 'any' (OR)",
				"conditions":    "array of {path?: string, operator: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'contains'|'regex'|'changed', value?: string}",
				"mode":          "string (optional, default 'every') - 'every' | 'once' | 'Transition' | 'count_window' | 'sustained'",
				"target_topic":  "string (required) - Action topic to publish to (no wildcards)",
				"payload":       "string (optional) - Action payload (supports {{payload}}, {{topic}}, {{json.field}})",
				"qos":           "number (optional, default 0)",
				"retain":        "boolean (optional, default false)",
				"cooldown_sec":  "number (optional, default 0) - Minimum seconds between triggers",
				"self_guard":    "boolean (optional, default true) - Prevent infinite loops when source overlaps target",
				"enabled":       "boolean (optional, default true)",
			},
			Example: map[string]any{
				"source_topic": "sensors/greenhouse/climate",
				"match":        "all",
				"conditions": []map[string]any{
					{"path": "temperature", "operator": "gt", "value": "30"},
				},
				"mode":         "every",
				"target_topic": "actuators/exhaust_fan/set",
				"payload":      `{"state": "ON", "reason": "high_temp"}`,
				"cooldown_sec": 60,
				"self_guard":   true,
				"enabled":      true,
			},
		},
		{
			Type:        "text",
			Category:    "visual",
			Description: "Markdown card for dashboard headers, zone descriptions, status notes, or documentation.",
			DefaultW:    4,
			DefaultH:    2,
			ConfigShape: map[string]any{
				"markdown": "string (required) - GitHub-flavored Markdown content",
			},
			Example: map[string]any{
				"markdown": "# 🌱 Smart Greenhouse\n\nLive environmental telemetry & irrigation controls.\n- Zone A & B sensors\n- Automated misting rules",
			},
		},
		{
			Type:        "separator",
			Category:    "visual",
			Description: "Visual horizontal or vertical divider line to organize dashboard zones.",
			DefaultW:    12,
			DefaultH:    1,
			ConfigShape: map[string]any{
				"orientation": "string (optional, default 'horizontal') - 'horizontal' (12x1) | 'vertical' (1xN)",
			},
			Example: map[string]any{
				"orientation": "horizontal",
			},
		},
		{
			Type:        "image",
			Category:    "visual",
			Description: "Static image, architecture diagram, or floor plan card.",
			DefaultW:    4,
			DefaultH:    3,
			ConfigShape: map[string]any{
				"src": "string (required) - Image URL or /api/images/<filename>",
			},
			Example: map[string]any{
				"src": "https://images.unsplash.com/photo-1558449028-b53a39d100fc?auto=format&fit=crop&w=800&q=80",
			},
		},
	}
}

var validPanelTypes = func() map[string]PanelTypeSpec {
	m := make(map[string]PanelTypeSpec)
	for _, spec := range PanelCatalog() {
		m[spec.Type] = spec
	}
	return m
}()

// IsValidPanelType reports whether panelType is one of the 13 supported panel types.
func IsValidPanelType(panelType string) bool {
	_, ok := validPanelTypes[panelType]
	return ok
}

// DefaultPanelSize returns the recommended (w, h) on the 12-column grid for a panel type and config.
func DefaultPanelSize(panelType string, cfgJSON json.RawMessage) (int, int) {
	if panelType == "separator" {
		var cfg struct {
			Orientation string `json:"orientation"`
		}
		if len(cfgJSON) > 0 && json.Unmarshal(cfgJSON, &cfg) == nil && cfg.Orientation == "vertical" {
			return 1, 4
		}
		return 12, 1
	}
	if spec, ok := validPanelTypes[panelType]; ok {
		return spec.DefaultW, spec.DefaultH
	}
	return 4, 3
}

// NormalizeAndLayoutPanels fills in missing dimensions and optionally auto-packs panels
// on the 12-column grid when coordinates are omitted or autoLayout is true.
func NormalizeAndLayoutPanels(panels []models.ImportPanel, autoLayout bool) ([]models.ImportPanel, error) {
	if len(panels) == 0 {
		return panels, nil
	}

	result := make([]models.ImportPanel, len(panels))
	copy(result, panels)

	// Detect if caller left all (x, y) at (0, 0) with multiple panels -> enable auto-layout automatically.
	allZeroPos := len(result) > 1
	for i := range result {
		p := &result[i]
		p.PanelType = strings.TrimSpace(p.PanelType)
		if p.PanelType == "" {
			return nil, fmt.Errorf("panel[%d] (%q): panel_type is required", i, p.Title)
		}
		if !IsValidPanelType(p.PanelType) {
			return nil, fmt.Errorf("panel[%d] (%q): unsupported panel_type %q (valid types: gauge, graph, stats, log, button, toggle, slider, input, cron, logic, text, separator, image)", i, p.Title, p.PanelType)
		}
		defW, defH := DefaultPanelSize(p.PanelType, p.ConfigJSON)
		if p.W <= 0 {
			p.W = defW
		}
		if p.W > 12 {
			p.W = 12
		}
		if p.H <= 0 {
			p.H = defH
		}
		if p.X != 0 || p.Y != 0 {
			allZeroPos = false
		}
	}

	if !autoLayout && !allZeroPos {
		// Clamp X so x + w <= 12
		for i := range result {
			if result[i].X < 0 {
				result[i].X = 0
			}
			if result[i].X+result[i].W > 12 {
				result[i].X = 12 - result[i].W
			}
			if result[i].Y < 0 {
				result[i].Y = 0
			}
		}
		return result, nil
	}

	// Row-packing algorithm on a 12-column occupancy grid.
	// Track the height of each column or occupied cells.
	occupied := make(map[[2]int]bool)
	isFree := func(x, y, w, h int) bool {
		if x < 0 || x+w > 12 || y < 0 {
			return false
		}
		for dy := 0; dy < h; dy++ {
			for dx := 0; dx < w; dx++ {
				if occupied[[2]int{x + dx, y + dy}] {
					return false
				}
			}
		}
		return true
	}
	markOccupied := func(x, y, w, h int) {
		for dy := 0; dy < h; dy++ {
			for dx := 0; dx < w; dx++ {
				occupied[[2]int{x + dx, y + dy}] = true
			}
		}
	}

	cursorY := 0
	for i := range result {
		w, h := result[i].W, result[i].H
		placed := false
		for y := cursorY; y < cursorY+500 && !placed; y++ {
			for x := 0; x <= 12-w; x++ {
				if isFree(x, y, w, h) {
					result[i].X = x
					result[i].Y = y
					markOccupied(x, y, w, h)
					placed = true
					break
				}
			}
		}
	}

	return result, nil
}

// BuildSchemaDocumentation returns a comprehensive guide for AI agents covering the 12-column grid,
// payload shaping with {value} tokens, and all panel types.
func BuildSchemaDocumentation(filterType string) (string, error) {
	filterType = strings.TrimSpace(strings.ToLower(filterType))
	if filterType != "" {
		spec, ok := validPanelTypes[filterType]
		if !ok {
			return "", fmt.Errorf("unknown panel_type %q", filterType)
		}
		b, err := json.MarshalIndent(spec, "", "  ")
		if err != nil {
			return "", err
		}
		return string(b), nil
	}

	doc := map[string]any{
		"grid_system": map[string]any{
			"columns": 12,
			"rules": []string{
				"Grid is 12 columns wide (x from 0 to 11, x + w <= 12, y >= 0).",
				"If you omit x/y or pass auto_layout=true to create_dashboard, panels are automatically packed onto the 12-column grid.",
				"Recommended compact layout structure: top row with a 'text' header card (w:4, h:2), a vertical 'separator' (w:1, h:4), and key 'button'/'toggle'/'stats' controls on the right (x:5..11); middle rows separated by a horizontal 'separator' (w:12, h:1) followed by 'gauge' (w:3, h:3 or w:4, h:3), 'slider' (w:4, h:2), and 'logic'/'cron' panels; bottom rows with 'graph' (w:6, h:4) and 'log' (w:6, h:3 or w:12, h:3).",
			},
		},
		"payload_shaping": map[string]any{
			"value_token": "{value}",
			"explanation": "Interactive and monitor panels use '{value}' in readTemplate and payloadTemplate to extract or format MQTT payloads.",
			"examples": map[string]string{
				"raw_number_or_string": "{value}",
				"json_numeric_field":   `{"temperature": {value}}`,
				"json_string_field":    `{"state": "{value}"}`,
				"nested_json_field":    `{"sensor": {"telemetry": {"temp": {value}}}}`,
			},
		},
		"panel_types": PanelCatalog(),
	}

	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}
