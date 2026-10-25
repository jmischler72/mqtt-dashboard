package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"mqtt-dashboard/logic"
	"mqtt-dashboard/models"
	mqttutil "mqtt-dashboard/mqtt"
)

type toolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func (s *Server) toolDefinitions() []toolDef {
	return []toolDef{
		{
			Name:        "list_brokers",
			Description: "List all configured MQTT brokers with their ID, name, host, port, enabled state, and live connection status.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "explore_topics",
			Description: "Discover active MQTT topics captured on a broker, including message counts, latest timestamp, and a sample payload for each topic so you can infer JSON paths and {value} templates.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"broker_id": map[string]any{
						"type":        "string",
						"description": "Optional broker ID or name (defaults to the first enabled broker).",
					},
					"filter": map[string]any{
						"type":        "string",
						"description": "Optional MQTT wildcard filter (e.g. 'sensors/#', 'home/+/temp') or substring filter.",
					},
					"limit": map[string]any{
						"type":        "integer",
						"description": "Maximum number of topics to return (default 100, max 500).",
					},
				},
			},
		},
		{
			Name:        "sample_topic_payload",
			Description: "Fetch recent MQTT messages for a specific topic (or wildcard filter) to inspect exact payload structures, JSON keys, and value ranges.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"topic": map[string]any{
						"type":        "string",
						"description": "MQTT topic or wildcard pattern (e.g. 'sensors/livingroom/climate' or 'sensors/#').",
					},
					"broker_id": map[string]any{
						"type":        "string",
						"description": "Optional broker ID or name (defaults to the first enabled broker).",
					},
					"limit": map[string]any{
						"type":        "integer",
						"description": "Number of recent messages to return (default 5, max 50).",
					},
				},
				"required": []string{"topic"},
			},
		},
		{
			Name:        "get_panel_schema",
			Description: "Get the complete schema reference for all 13 MQTT Dashboard panel types (gauge, graph, stats, log, button, toggle, slider, input, cron, logic, text, separator, image), {value} payload shaping syntax, and 12-column grid layout rules.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"panel_type": map[string]any{
						"type":        "string",
						"description": "Optional specific panel type to inspect (e.g. 'gauge', 'toggle', 'logic'). Omit to get the full catalog and grid guide.",
					},
				},
			},
		},
		{
			Name:        "list_dashboards",
			Description: "List all existing dashboards with their ID, name, creation timestamp, and panel count.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        "get_dashboard",
			Description: "Retrieve a dashboard's full layout, panel configurations, and portable export JSON by dashboard_id or name.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"dashboard_id": map[string]any{
						"type":        "string",
						"description": "Dashboard UUID (optional if name is provided).",
					},
					"name": map[string]any{
						"type":        "string",
						"description": "Dashboard name (case-insensitive lookup if dashboard_id is omitted).",
					},
				},
			},
		},
		{
			Name:        "create_dashboard",
			Description: "Create a new dashboard with a set of panels from a project description or broker topic inspection. Automatically validates panel types, resolves brokers, packs panels onto the 12-column grid if coordinates are omitted or auto_layout=true, and registers cron/logic automations.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name": map[string]any{
						"type":        "string",
						"description": "Name of the new dashboard.",
					},
					"auto_layout": map[string]any{
						"type":        "boolean",
						"description": "If true, automatically computes non-overlapping (x, y) positions on the 12-column grid.",
					},
					"dry_run": map[string]any{
						"type":        "boolean",
						"description": "If true, validates and returns the portable dashboard export JSON without saving to the database.",
					},
					"panels": map[string]any{
						"type":        "array",
						"description": "Panels to include in the dashboard.",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"title":       map[string]any{"type": "string", "description": "Panel title"},
								"panel_type":  map[string]any{"type": "string", "description": "One of: gauge, graph, stats, log, button, toggle, slider, input, cron, logic, text, separator, image"},
								"x":           map[string]any{"type": "integer", "description": "Grid column (0..11)"},
								"y":           map[string]any{"type": "integer", "description": "Grid row (0+)"},
								"w":           map[string]any{"type": "integer", "description": "Grid width (1..12)"},
								"h":           map[string]any{"type": "integer", "description": "Grid height (1+)"},
								"broker_id":   map[string]any{"type": "string", "description": "Optional broker ID"},
								"broker_name": map[string]any{"type": "string", "description": "Optional broker name"},
								"config_json": map[string]any{"type": "object", "description": "Panel-specific configuration object (see get_panel_schema)"},
							},
							"required": []string{"title", "panel_type"},
						},
					},
				},
				"required": []string{"name", "panels"},
			},
		},
		{
			Name:        "update_dashboard",
			Description: "Update an existing dashboard by appending new panels at the bottom or replacing all panels (and optionally renaming the dashboard).",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"dashboard_id": map[string]any{
						"type":        "string",
						"description": "ID of the dashboard to update.",
					},
					"name": map[string]any{
						"type":        "string",
						"description": "Optional new name for the dashboard.",
					},
					"mode": map[string]any{
						"type":        "string",
						"enum":        []string{"append", "replace"},
						"description": "'append' adds panels below existing ones (default); 'replace' replaces all panels on the dashboard.",
					},
					"auto_layout": map[string]any{
						"type":        "boolean",
						"description": "If true, automatically packs the provided panels on the 12-column grid.",
					},
					"panels": map[string]any{
						"type":        "array",
						"description": "Panels to append or replace with.",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"title":       map[string]any{"type": "string"},
								"panel_type":  map[string]any{"type": "string"},
								"x":           map[string]any{"type": "integer"},
								"y":           map[string]any{"type": "integer"},
								"w":           map[string]any{"type": "integer"},
								"h":           map[string]any{"type": "integer"},
								"broker_id":   map[string]any{"type": "string"},
								"broker_name": map[string]any{"type": "string"},
								"config_json": map[string]any{"type": "object"},
							},
							"required": []string{"title", "panel_type"},
						},
					},
				},
				"required": []string{"dashboard_id", "panels"},
			},
		},
		{
			Name:        "delete_dashboard",
			Description: "Delete a dashboard and all its panels by dashboard_id (cannot delete the last remaining dashboard).",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"dashboard_id": map[string]any{
						"type":        "string",
						"description": "UUID of the dashboard to delete.",
					},
				},
				"required": []string{"dashboard_id"},
			},
		},
		{
			Name:        "publish_message",
			Description: "Publish an MQTT message to a broker topic (useful for seeding simulated sensor data or testing controls).",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"topic": map[string]any{
						"type":        "string",
						"description": "Target MQTT topic (no wildcards).",
					},
					"payload": map[string]any{
						"type":        "string",
						"description": "Message payload string or JSON.",
					},
					"broker_id": map[string]any{
						"type":        "string",
						"description": "Optional broker ID or name (defaults to default enabled broker).",
					},
					"qos": map[string]any{
						"type":        "integer",
						"description": "MQTT QoS level (0, 1, or 2; default 0).",
					},
					"retain": map[string]any{
						"type":        "boolean",
						"description": "Whether to set the MQTT retained flag (default false).",
					},
				},
				"required": []string{"topic", "payload"},
			},
		},
	}
}

func (s *Server) callTool(_ context.Context, name string, rawArgs json.RawMessage) (string, bool, *jsonRPCError) {
	if len(rawArgs) == 0 || string(rawArgs) == "null" {
		rawArgs = json.RawMessage("{}")
	}

	var (
		res any
		err error
	)

	switch name {
	case "list_brokers":
		res, err = s.toolListBrokers()
	case "explore_topics":
		res, err = s.toolExploreTopics(rawArgs)
	case "sample_topic_payload":
		res, err = s.toolSampleTopicPayload(rawArgs)
	case "get_panel_schema":
		var args struct {
			PanelType string `json:"panel_type"`
		}
		_ = json.Unmarshal(rawArgs, &args)
		doc, docErr := BuildSchemaDocumentation(args.PanelType)
		if docErr != nil {
			return docErr.Error(), true, nil
		}
		return doc, false, nil
	case "list_dashboards":
		res, err = s.toolListDashboards()
	case "get_dashboard":
		res, err = s.toolGetDashboard(rawArgs)
	case "create_dashboard":
		res, err = s.toolCreateDashboard(rawArgs)
	case "update_dashboard":
		res, err = s.toolUpdateDashboard(rawArgs)
	case "delete_dashboard":
		res, err = s.toolDeleteDashboard(rawArgs)
	case "publish_message":
		res, err = s.toolPublishMessage(rawArgs)
	default:
		return "", false, &jsonRPCError{
			Code:    -32602,
			Message: fmt.Sprintf("Unknown tool: %s", name),
		}
	}

	if err != nil {
		return err.Error(), true, nil
	}

	b, marshalErr := json.MarshalIndent(res, "", "  ")
	if marshalErr != nil {
		return marshalErr.Error(), true, nil
	}
	return string(b), false, nil
}

func (s *Server) resolveDefaultBrokerID(requested string) string {
	if requested != "" {
		var exists string
		if err := s.db.QueryRow(`SELECT id FROM mqtt_brokers WHERE id = ?`, requested).Scan(&exists); err == nil {
			return exists
		}
		if err := s.db.QueryRow(`SELECT id FROM mqtt_brokers WHERE LOWER(name) = LOWER(?)`, requested).Scan(&exists); err == nil {
			return exists
		}
	}
	if s.registry != nil {
		if id := s.registry.DefaultBrokerID(); id != "" {
			return id
		}
	}
	var fallback string
	_ = s.db.QueryRow(`SELECT id FROM mqtt_brokers WHERE is_enabled = 1 ORDER BY sort_order ASC LIMIT 1`).Scan(&fallback)
	if fallback == "" {
		_ = s.db.QueryRow(`SELECT id FROM mqtt_brokers ORDER BY sort_order ASC LIMIT 1`).Scan(&fallback)
	}
	return fallback
}

func (s *Server) toolListBrokers() (any, error) {
	rows, err := s.db.Query(`SELECT id, name, host, port, COALESCE(client_id, ''), COALESCE(username, ''), is_enabled, sort_order, COALESCE(auth_mode, 'none'), tls_enabled FROM mqtt_brokers ORDER BY sort_order ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var brokers []models.MQTTBroker
	for rows.Next() {
		var b models.MQTTBroker
		if err := rows.Scan(&b.ID, &b.Name, &b.Host, &b.Port, &b.ClientID, &b.Username, &b.IsEnabled, &b.SortOrder, &b.AuthMode, &b.TLSEnabled); err != nil {
			return nil, err
		}
		if s.registry != nil {
			b.Status = s.registry.Status(b.ID)
			b.StatusError = s.registry.StatusError(b.ID)
		}
		brokers = append(brokers, b)
	}
	if brokers == nil {
		brokers = []models.MQTTBroker{}
	}
	return map[string]any{
		"brokers": brokers,
		"count":   len(brokers),
	}, nil
}

func (s *Server) toolExploreTopics(rawArgs json.RawMessage) (any, error) {
	var args struct {
		BrokerID string `json:"broker_id"`
		Filter   string `json:"filter"`
		Limit    int    `json:"limit"`
	}
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}

	brokerID := s.resolveDefaultBrokerID(args.BrokerID)
	if brokerID == "" {
		return map[string]any{
			"broker_id": "",
			"topics":    []any{},
			"note":      "No MQTT brokers configured yet.",
		}, nil
	}

	limit := args.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := s.db.Query(`
		SELECT topic,
		       COUNT(*) AS msg_count,
		       MAX(timestamp) AS last_seen,
		       COALESCE((
		           SELECT h2.payload
		           FROM mqtt_history h2
		           WHERE h2.broker_id = mqtt_history.broker_id AND h2.topic = mqtt_history.topic
		           ORDER BY h2.timestamp DESC, h2.id DESC
		           LIMIT 1
		       ), '') AS sample_payload
		FROM mqtt_history
		WHERE broker_id = ?
		GROUP BY topic
		ORDER BY topic ASC
	`, brokerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type topicSummary struct {
		Topic         string `json:"topic"`
		MessageCount  int    `json:"message_count"`
		LastSeen      string `json:"last_seen"`
		SamplePayload string `json:"sample_payload"`
	}

	filter := strings.TrimSpace(args.Filter)
	hasWild := mqttutil.HasWildcard(filter)
	lowerFilter := strings.ToLower(filter)

	var topics []topicSummary
	for rows.Next() {
		var t topicSummary
		if err := rows.Scan(&t.Topic, &t.MessageCount, &t.LastSeen, &t.SamplePayload); err != nil {
			continue
		}
		if filter != "" {
			if hasWild {
				if !mqttutil.TopicMatches(filter, t.Topic) {
					continue
				}
			} else if !strings.Contains(strings.ToLower(t.Topic), lowerFilter) {
				continue
			}
		}
		if len(t.SamplePayload) > 512 {
			t.SamplePayload = t.SamplePayload[:512] + "...(truncated)"
		}
		topics = append(topics, t)
		if len(topics) >= limit {
			break
		}
	}
	if topics == nil {
		topics = []topicSummary{}
	}

	return map[string]any{
		"broker_id": brokerID,
		"count":     len(topics),
		"topics":    topics,
	}, nil
}

func (s *Server) toolSampleTopicPayload(rawArgs json.RawMessage) (any, error) {
	var args struct {
		BrokerID string `json:"broker_id"`
		Topic    string `json:"topic"`
		Limit    int    `json:"limit"`
	}
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	topic := strings.TrimSpace(args.Topic)
	if topic == "" {
		return nil, errors.New("topic is required")
	}

	brokerID := s.resolveDefaultBrokerID(args.BrokerID)
	if brokerID == "" {
		return nil, errors.New("no broker available")
	}

	limit := args.Limit
	if limit <= 0 {
		limit = 5
	}
	if limit > 50 {
		limit = 50
	}

	type msgSample struct {
		Topic     string `json:"topic"`
		Payload   string `json:"payload"`
		Timestamp string `json:"timestamp"`
		QoS       int    `json:"qos"`
		Retained  bool   `json:"retained"`
	}

	var (
		rows *sql.Rows
		err  error
	)
	if mqttutil.HasWildcard(topic) {
		likePattern := mqttutil.ToSQLLikePattern(topic)
		rows, err = s.db.Query(`
			SELECT topic, COALESCE(payload, ''), timestamp, qos, retained
			FROM mqtt_history
			WHERE broker_id = ? AND topic LIKE ?
			ORDER BY timestamp DESC, id DESC
			LIMIT ?
		`, brokerID, likePattern, limit*4)
	} else {
		rows, err = s.db.Query(`
			SELECT topic, COALESCE(payload, ''), timestamp, qos, retained
			FROM mqtt_history
			WHERE broker_id = ? AND topic = ?
			ORDER BY timestamp DESC, id DESC
			LIMIT ?
		`, brokerID, topic, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []msgSample
	for rows.Next() {
		var m msgSample
		if err := rows.Scan(&m.Topic, &m.Payload, &m.Timestamp, &m.QoS, &m.Retained); err != nil {
			continue
		}
		if mqttutil.HasWildcard(topic) && !mqttutil.TopicMatches(topic, m.Topic) {
			continue
		}
		messages = append(messages, m)
		if len(messages) >= limit {
			break
		}
	}
	if messages == nil {
		messages = []msgSample{}
	}

	return map[string]any{
		"broker_id": brokerID,
		"topic":     topic,
		"count":     len(messages),
		"messages":  messages,
	}, nil
}

func (s *Server) toolListDashboards() (any, error) {
	rows, err := s.db.Query(`
		SELECT d.id, d.name, d.created_at, COUNT(p.id) AS panel_count
		FROM dashboards d
		LEFT JOIN dashboard_layouts p ON p.dashboard_id = d.id
		GROUP BY d.id, d.name, d.created_at
		ORDER BY d.created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type dashSummary struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		CreatedAt  string `json:"created_at"`
		PanelCount int    `json:"panel_count"`
	}

	var list []dashSummary
	for rows.Next() {
		var d dashSummary
		if err := rows.Scan(&d.ID, &d.Name, &d.CreatedAt, &d.PanelCount); err != nil {
			return nil, err
		}
		list = append(list, d)
	}
	if list == nil {
		list = []dashSummary{}
	}
	return map[string]any{
		"dashboards": list,
		"count":      len(list),
	}, nil
}

func (s *Server) toolGetDashboard(rawArgs json.RawMessage) (any, error) {
	var args struct {
		DashboardID string `json:"dashboard_id"`
		Name        string `json:"name"`
	}
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}

	var d models.Dashboard
	var err error
	if args.DashboardID != "" {
		err = s.db.QueryRow(`SELECT id, name, created_at FROM dashboards WHERE id = ?`, args.DashboardID).Scan(&d.ID, &d.Name, &d.CreatedAt)
	} else if args.Name != "" {
		err = s.db.QueryRow(`SELECT id, name, created_at FROM dashboards WHERE LOWER(name) = LOWER(?) LIMIT 1`, args.Name).Scan(&d.ID, &d.Name, &d.CreatedAt)
	} else {
		return nil, errors.New("either dashboard_id or name is required")
	}
	if err != nil {
		return nil, fmt.Errorf("dashboard not found: %w", err)
	}

	rows, err := s.db.Query(`
		SELECT id, dashboard_id, title, panel_type, x, y, w, h, COALESCE(config_json, '{}'), COALESCE(broker_id, '')
		FROM dashboard_layouts
		WHERE dashboard_id = ?
		ORDER BY y ASC, x ASC
	`, d.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var panels []models.DashboardPanel
	var exportPanels []models.ImportPanel
	for rows.Next() {
		var p models.DashboardPanel
		var cfgStr string
		if err := rows.Scan(&p.ID, &p.DashboardID, &p.Title, &p.PanelType, &p.X, &p.Y, &p.W, &p.H, &cfgStr, &p.BrokerID); err != nil {
			return nil, err
		}
		p.ConfigJSON = json.RawMessage(cfgStr)
		panels = append(panels, p)
		exportPanels = append(exportPanels, models.ImportPanel{
			Title:      p.Title,
			PanelType:  p.PanelType,
			X:          p.X,
			Y:          p.Y,
			W:          p.W,
			H:          p.H,
			ConfigJSON: p.ConfigJSON,
			BrokerID:   p.BrokerID,
		})
	}
	if panels == nil {
		panels = []models.DashboardPanel{}
	}
	if exportPanels == nil {
		exportPanels = []models.ImportPanel{}
	}

	exportEnvelope := models.DashboardImportPayload{
		Type:    "mqtt-dashboard-export",
		Version: 1,
		Name:    d.Name,
		Panels:  exportPanels,
	}

	return map[string]any{
		"dashboard":   d,
		"panel_count": len(panels),
		"panels":      panels,
		"export_json": exportEnvelope,
	}, nil
}

func (s *Server) toolCreateDashboard(rawArgs json.RawMessage) (any, error) {
	var args struct {
		Name       string               `json:"name"`
		AutoLayout bool                 `json:"auto_layout"`
		DryRun     bool                 `json:"dry_run"`
		Panels     []models.ImportPanel `json:"panels"`
	}
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	args.Name = strings.TrimSpace(args.Name)
	if args.Name == "" {
		return nil, errors.New("name is required")
	}

	normalizedPanels, err := NormalizeAndLayoutPanels(args.Panels, args.AutoLayout)
	if err != nil {
		return nil, err
	}

	payload := models.DashboardImportPayload{
		Type:    "mqtt-dashboard-export",
		Version: 1,
		Name:    args.Name,
		Panels:  normalizedPanels,
	}

	if args.DryRun {
		return map[string]any{
			"dry_run":     true,
			"name":        args.Name,
			"panel_count": len(normalizedPanels),
			"export_json": payload,
		}, nil
	}

	d, status, err := s.dashboardH.ImportDashboardPayload(payload)
	if err != nil || status != http.StatusCreated {
		return nil, fmt.Errorf("create dashboard failed: %w", err)
	}

	return map[string]any{
		"dashboard_id": d.ID,
		"name":         d.Name,
		"created_at":   d.CreatedAt,
		"panel_count":  len(normalizedPanels),
		"export_json":  payload,
	}, nil
}

func (s *Server) toolUpdateDashboard(rawArgs json.RawMessage) (any, error) {
	var args struct {
		DashboardID string               `json:"dashboard_id"`
		Name        string               `json:"name"`
		Mode        string               `json:"mode"`
		AutoLayout  bool                 `json:"auto_layout"`
		Panels      []models.ImportPanel `json:"panels"`
	}
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if args.DashboardID == "" {
		return nil, errors.New("dashboard_id is required")
	}

	var currentName string
	if err := s.db.QueryRow(`SELECT name FROM dashboards WHERE id = ?`, args.DashboardID).Scan(&currentName); err != nil {
		return nil, fmt.Errorf("dashboard %q not found", args.DashboardID)
	}

	mode := strings.ToLower(strings.TrimSpace(args.Mode))
	if mode == "" {
		mode = "append"
	}
	if mode != "append" && mode != "replace" {
		return nil, errors.New("mode must be 'append' or 'replace'")
	}

	normalizedPanels, err := NormalizeAndLayoutPanels(args.Panels, args.AutoLayout)
	if err != nil {
		return nil, err
	}

	// If appending and the new panels start at y == 0, shift them below existing panels.
	if mode == "append" && len(normalizedPanels) > 0 {
		var maxY int
		_ = s.db.QueryRow(`SELECT COALESCE(MAX(y + h), 0) FROM dashboard_layouts WHERE dashboard_id = ?`, args.DashboardID).Scan(&maxY)
		if maxY > 0 {
			minNewY := normalizedPanels[0].Y
			for _, p := range normalizedPanels[1:] {
				if p.Y < minNewY {
					minNewY = p.Y
				}
			}
			if minNewY < maxY {
				offset := maxY - minNewY
				for i := range normalizedPanels {
					normalizedPanels[i].Y += offset
				}
			}
		}
	}

	defaultBrokerID := s.resolveDefaultBrokerID("")

	// Collect existing panel IDs if mode == "replace" so we can clean up cron/logic/ws.
	var oldPanelIDs []string
	if mode == "replace" {
		rows, qErr := s.db.Query(`SELECT id FROM dashboard_layouts WHERE dashboard_id = ?`, args.DashboardID)
		if qErr == nil {
			for rows.Next() {
				var pid string
				if rows.Scan(&pid) == nil {
					oldPanelIDs = append(oldPanelIDs, pid)
				}
			}
			rows.Close()
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint

	if strings.TrimSpace(args.Name) != "" {
		currentName = strings.TrimSpace(args.Name)
		if _, err := tx.Exec(`UPDATE dashboards SET name = ? WHERE id = ?`, currentName, args.DashboardID); err != nil {
			return nil, err
		}
	}

	if mode == "replace" {
		if _, err := tx.Exec(`DELETE FROM dashboard_layouts WHERE dashboard_id = ?`, args.DashboardID); err != nil {
			return nil, err
		}
	}

	type cronJob struct {
		panelID, brokerID, cronExpr, topic, payload string
		qos                                         int
		retain, enabled                             bool
	}
	var cronJobs []cronJob
	var logicRules []logic.Rule

	for _, p := range normalizedPanels {
		brokerID := defaultBrokerID
		if p.BrokerID != "" {
			var exists string
			if err := tx.QueryRow(`SELECT id FROM mqtt_brokers WHERE id = ?`, p.BrokerID).Scan(&exists); err == nil {
				brokerID = p.BrokerID
			}
		} else if p.BrokerName != "" {
			var exists string
			if err := tx.QueryRow(`SELECT id FROM mqtt_brokers WHERE name = ?`, p.BrokerName).Scan(&exists); err == nil {
				brokerID = exists
			}
		}

		cfgJSON := string(p.ConfigJSON)
		if cfgJSON == "" || cfgJSON == "null" {
			cfgJSON = "{}"
		}
		title := p.Title
		if title == "" {
			title = "Panel"
		}

		panelID := uuid.New().String()
		if _, err := tx.Exec(
			`INSERT INTO dashboard_layouts (id, dashboard_id, title, panel_type, x, y, w, h, config_json, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			panelID, args.DashboardID, title, p.PanelType, p.X, p.Y, p.W, p.H, cfgJSON, brokerID,
		); err != nil {
			return nil, err
		}

		if p.PanelType == "cron" {
			var cfg struct {
				CronExpr string `json:"cron_expr"`
				Topic    string `json:"topic"`
				Payload  string `json:"payload"`
				QoS      int    `json:"qos"`
				Retain   bool   `json:"retain"`
				Enabled  bool   `json:"enabled"`
			}
			if err := json.Unmarshal([]byte(cfgJSON), &cfg); err == nil && cfg.CronExpr != "" {
				cronJobs = append(cronJobs, cronJob{
					panelID:  panelID,
					brokerID: brokerID,
					cronExpr: cfg.CronExpr,
					topic:    cfg.Topic,
					payload:  cfg.Payload,
					qos:      cfg.QoS,
					retain:   cfg.Retain,
					enabled:  cfg.Enabled,
				})
			}
		}
		if p.PanelType == "logic" {
			var r logic.Rule
			if err := json.Unmarshal([]byte(cfgJSON), &r); err == nil && r.SourceTopic != "" && r.TargetTopic != "" {
				r.PanelID = panelID
				if r.BrokerID == "" {
					r.BrokerID = brokerID
				}
				logicRules = append(logicRules, r)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	for _, pid := range oldPanelIDs {
		if s.scheduler != nil {
			s.scheduler.RemoveJob(pid)
		}
		if s.logicEngine != nil {
			s.logicEngine.RemoveRule(pid)
		}
		if s.invalidator != nil {
			s.invalidator.InvalidatePanelMeta(pid)
		}
	}

	if s.scheduler != nil {
		for _, j := range cronJobs {
			if err := s.scheduler.AddJob(j.panelID, j.brokerID, j.cronExpr, j.topic, j.payload, byte(j.qos), j.retain, j.enabled); err != nil {
				slog.Error("mcp update_dashboard: register cron job", "panel_id", j.panelID, "err", err)
			}
		}
	}
	if s.logicEngine != nil {
		for _, r := range logicRules {
			rule := r
			if err := s.logicEngine.AddRule(&rule); err != nil {
				slog.Error("mcp update_dashboard: register logic rule", "panel_id", rule.PanelID, "err", err)
			}
		}
	}

	var totalPanels int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM dashboard_layouts WHERE dashboard_id = ?`, args.DashboardID).Scan(&totalPanels)

	return map[string]any{
		"dashboard_id": args.DashboardID,
		"name":         currentName,
		"mode":         mode,
		"added_count":  len(normalizedPanels),
		"total_panels": totalPanels,
	}, nil
}

func (s *Server) toolDeleteDashboard(rawArgs json.RawMessage) (any, error) {
	var args struct {
		DashboardID string `json:"dashboard_id"`
	}
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if args.DashboardID == "" {
		return nil, errors.New("dashboard_id is required")
	}

	code, err := s.dashboardH.DeleteDashboardByID(args.DashboardID)
	if err != nil {
		if code == http.StatusNotFound {
			return nil, fmt.Errorf("dashboard %q not found", args.DashboardID)
		}
		return nil, err
	}

	return map[string]any{
		"deleted":      true,
		"dashboard_id": args.DashboardID,
	}, nil
}

func (s *Server) toolPublishMessage(rawArgs json.RawMessage) (any, error) {
	var args struct {
		BrokerID string          `json:"broker_id"`
		Topic    string          `json:"topic"`
		Payload  json.RawMessage `json:"payload"`
		QoS      int             `json:"qos"`
		Retain   bool            `json:"retain"`
	}
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	topic := strings.TrimSpace(args.Topic)
	if topic == "" {
		return nil, errors.New("topic is required")
	}
	if mqttutil.HasWildcard(topic) {
		return nil, errors.New("cannot publish to wildcard topics (+ or #)")
	}
	if args.QoS < 0 || args.QoS > 2 {
		return nil, errors.New("qos must be 0, 1, or 2")
	}
	if s.registry == nil {
		return nil, errors.New("broker registry not initialized")
	}

	brokerID := s.resolveDefaultBrokerID(args.BrokerID)
	if brokerID == "" {
		return nil, errors.New("no broker available")
	}

	var payloadBytes []byte
	trimmedPayload := strings.TrimSpace(string(args.Payload))
	if len(trimmedPayload) > 0 {
		var str string
		if json.Unmarshal(args.Payload, &str) == nil {
			payloadBytes = []byte(str)
		} else {
			payloadBytes = []byte(trimmedPayload)
		}
	}

	if err := s.registry.Publish(brokerID, topic, byte(args.QoS), args.Retain, payloadBytes); err != nil {
		return nil, fmt.Errorf("publish failed: %w", err)
	}

	return map[string]any{
		"status":    "published",
		"broker_id": brokerID,
		"topic":     topic,
	}, nil
}
