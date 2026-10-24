package mcp

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mqtt-dashboard/handlers"
)

const (
	DefaultProtocolVersion = "2024-11-05"
	ServerName             = "mqtt-dashboard"
)

// Server implements the Model Context Protocol (MCP) over Streamable HTTP (/mcp),
// HTTP+SSE (/mcp/sse & /mcp/messages), and Stdio (--mcp-stdio).
type Server struct {
	db          *sql.DB
	registry    handlers.BrokerRegistry
	scheduler   handlers.CronScheduler
	logicEngine handlers.LogicEngine
	invalidator handlers.PanelMetaInvalidator
	dashboardH  *handlers.DashboardHandler
	version     string
	basePath    string
	enabled     atomic.Bool

	mu       sync.RWMutex
	sessions map[string]chan []byte
}

// NewServer creates a new MCP server wired to the application's database and runtime engines.
func NewServer(
	db *sql.DB,
	registry handlers.BrokerRegistry,
	scheduler handlers.CronScheduler,
	logicEngine handlers.LogicEngine,
	invalidator handlers.PanelMetaInvalidator,
	version string,
	basePath string,
) *Server {
	dashH := handlers.NewDashboardHandler(db, scheduler)
	dashH.SetInvalidator(invalidator)
	dashH.SetLogicEngine(logicEngine)

	if basePath == "" {
		basePath = "/"
	}
	srv := &Server{
		db:          db,
		registry:    registry,
		scheduler:   scheduler,
		logicEngine: logicEngine,
		invalidator: invalidator,
		dashboardH:  dashH,
		version:     version,
		basePath:    basePath,
		sessions:    make(map[string]chan []byte),
	}
	srv.enabled.Store(true)
	return srv
}

func (s *Server) SetEnabled(enabled bool) {
	s.enabled.Store(enabled)
}

func (s *Server) IsEnabled() bool {
	return s.enabled.Load()
}

// MountRoutes registers the MCP endpoints on the given Chi router:
//   - POST/GET/DELETE /mcp      (MCP Streamable HTTP transport)
//   - GET             /mcp/sse  (MCP HTTP+SSE transport stream)
//   - POST            /mcp/messages (MCP HTTP+SSE message endpoint)
func (s *Server) MountRoutes(r chi.Router) {
	r.Post("/mcp", s.HandleStreamableHTTP)
	r.Get("/mcp", s.HandleStreamableGET)
	r.Delete("/mcp", s.HandleSessionDelete)

	r.Get("/mcp/sse", s.HandleSSE)
	r.Post("/mcp/messages", s.HandleSSEMessage)
}

// --- JSON-RPC 2.0 Wire Types ---

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// --- HTTP Transports ---

// HandleStreamableHTTP handles POST /mcp (Streamable HTTP transport).
func (s *Server) HandleStreamableHTTP(w http.ResponseWriter, r *http.Request) {
	if !s.IsEnabled() {
		http.NotFound(w, r)
		return
	}
	sessionID := r.Header.Get("Mcp-Session-Id")
	if sessionID == "" {
		sessionID = uuid.New().String()
	}
	w.Header().Set("Mcp-Session-Id", sessionID)

	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeJSONRPCError(w, json.RawMessage("null"), -32700, "Failed to read request body", http.StatusBadRequest)
		return
	}

	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		writeJSONRPCError(w, json.RawMessage("null"), -32700, "Empty request body", http.StatusBadRequest)
		return
	}

	// Support batch JSON-RPC arrays as well as single objects.
	if strings.HasPrefix(trimmed, "[") {
		var batch []jsonRPCRequest
		if err := json.Unmarshal(body, &batch); err != nil {
			writeJSONRPCError(w, json.RawMessage("null"), -32700, "Parse error", http.StatusBadRequest)
			return
		}
		var responses []jsonRPCResponse
		for _, req := range batch {
			if resp := s.dispatch(r.Context(), req); resp != nil {
				responses = append(responses, *resp)
			}
		}
		if len(responses) == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(responses)
		return
	}

	var req jsonRPCRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSONRPCError(w, json.RawMessage("null"), -32700, "Parse error", http.StatusBadRequest)
		return
	}

	resp := s.dispatch(r.Context(), req)
	if resp == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// HandleStreamableGET handles GET /mcp. If the client requests text/event-stream, it opens
// an SSE stream; otherwise it returns a JSON status summary describing the MCP endpoint.
func (s *Server) HandleStreamableGET(w http.ResponseWriter, r *http.Request) {
	if !s.IsEnabled() {
		http.NotFound(w, r)
		return
	}
	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		s.HandleSSE(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"name":             ServerName,
		"version":          s.version,
		"protocol_version": DefaultProtocolVersion,
		"status":           "ok",
		"endpoints": map[string]string{
			"streamable_http": s.basePath + "mcp",
			"sse":             s.basePath + "mcp/sse",
			"messages":        s.basePath + "mcp/messages",
		},
	})
}

// HandleSessionDelete handles DELETE /mcp to close an active session.
func (s *Server) HandleSessionDelete(w http.ResponseWriter, r *http.Request) {
	if !s.IsEnabled() {
		http.NotFound(w, r)
		return
	}
	sessionID := r.Header.Get("Mcp-Session-Id")
	if sessionID != "" {
		s.removeSession(sessionID)
	}
	w.WriteHeader(http.StatusOK)
}

// HandleSSE handles GET /mcp/sse (MCP HTTP+SSE transport).
func (s *Server) HandleSSE(w http.ResponseWriter, r *http.Request) {
	if !s.IsEnabled() {
		http.NotFound(w, r)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	sessionID := uuid.New().String()
	ch := make(chan []byte, 32)
	s.mu.Lock()
	s.sessions[sessionID] = ch
	s.mu.Unlock()
	defer s.removeSession(sessionID)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Mcp-Session-Id", sessionID)

	msgEndpoint := strings.TrimSuffix(s.basePath, "/") + "/mcp/messages?sessionId=" + sessionID
	fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", msgEndpoint)
	flusher.Flush()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, open := <-ch:
			if !open {
				return
			}
			fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(msg))
			flusher.Flush()
		}
	}
}

// HandleSSEMessage handles POST /mcp/messages (MCP HTTP+SSE transport).
func (s *Server) HandleSSEMessage(w http.ResponseWriter, r *http.Request) {
	if !s.IsEnabled() {
		http.NotFound(w, r)
		return
	}
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		sessionID = r.Header.Get("Mcp-Session-Id")
	}

	var req jsonRPCRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&req); err != nil {
		writeJSONRPCError(w, json.RawMessage("null"), -32700, "Parse error", http.StatusBadRequest)
		return
	}

	resp := s.dispatch(r.Context(), req)
	if resp == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	s.mu.RLock()
	ch, hasSSE := s.sessions[sessionID]
	s.mu.RUnlock()

	if hasSSE {
		if b, err := json.Marshal(resp); err == nil {
			select {
			case ch <- b:
			default:
			}
		}
		w.WriteHeader(http.StatusAccepted)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) removeSession(sessionID string) {
	s.mu.Lock()
	if ch, ok := s.sessions[sessionID]; ok {
		delete(s.sessions, sessionID)
		close(ch)
	}
	s.mu.Unlock()
}

// ServeStdio runs the MCP server over line-delimited JSON-RPC on in/out (for --mcp-stdio mode).
func (s *Server) ServeStdio(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	enc := json.NewEncoder(out)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req jsonRPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			_ = enc.Encode(jsonRPCResponse{
				JSONRPC: "2.0",
				ID:      json.RawMessage("null"),
				Error:   &jsonRPCError{Code: -32700, Message: "Parse error"},
			})
			continue
		}
		if resp := s.dispatch(ctx, req); resp != nil {
			_ = enc.Encode(resp)
		}
	}
	return scanner.Err()
}

func writeJSONRPCError(w http.ResponseWriter, id json.RawMessage, code int, message string, httpStatus int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)
	_ = json.NewEncoder(w).Encode(jsonRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &jsonRPCError{Code: code, Message: message},
	})
}

// --- JSON-RPC Dispatcher ---

func (s *Server) dispatch(ctx context.Context, req jsonRPCRequest) *jsonRPCResponse {
	// Notifications have no ID and expect no response.
	if len(req.ID) == 0 || string(req.ID) == "null" {
		if strings.HasPrefix(req.Method, "notifications/") {
			return nil
		}
	}

	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &params)
		proto := DefaultProtocolVersion
		if params.ProtocolVersion == "2025-03-26" || params.ProtocolVersion == "2024-11-05" {
			proto = params.ProtocolVersion
		}
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"protocolVersion": proto,
				"capabilities": map[string]any{
					"tools":     map[string]any{"listChanged": false},
					"resources": map[string]any{"subscribe": false, "listChanged": false},
					"prompts":   map[string]any{"listChanged": false},
				},
				"serverInfo": map[string]any{
					"name":    ServerName,
					"version": s.version,
				},
				"instructions": "Use mqtt-dashboard MCP tools to inspect connected MQTT brokers, discover live topics and payload shapes, or design and create complete IoT dashboards from natural language descriptions. Call get_panel_schema first when designing a dashboard to learn the 13 panel types, {value} payload shaping syntax, and 12-column grid layout rules.",
			},
		}

	case "ping":
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  map[string]any{},
		}

	case "tools/list":
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"tools": s.toolDefinitions(),
			},
		}

	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return &jsonRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &jsonRPCError{Code: -32602, Message: "Invalid tool call params"},
			}
		}
		text, isErr, rpcErr := s.callTool(ctx, params.Name, params.Arguments)
		if rpcErr != nil {
			return &jsonRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   rpcErr,
			}
		}
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": text},
				},
				"isError": isErr,
			},
		}

	case "resources/list":
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"resources": []map[string]any{
					{
						"uri":         "mqtt-dashboard://schema/panels",
						"name":        "MQTT Dashboard Panel & Grid Schema",
						"description": "Complete specification of all 13 panel types, {value} payload shaping templates, and 12-column grid layout guidelines.",
						"mimeType":    "application/json",
					},
				},
			},
		}

	case "resources/read":
		var params struct {
			URI string `json:"uri"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil || params.URI != "mqtt-dashboard://schema/panels" {
			return &jsonRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &jsonRPCError{Code: -32602, Message: "Unknown resource URI"},
			}
		}
		doc, _ := BuildSchemaDocumentation("")
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"contents": []map[string]any{
					{
						"uri":      params.URI,
						"mimeType": "application/json",
						"text":     doc,
					},
				},
			},
		}

	case "prompts/list":
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"prompts": []map[string]any{
					{
						"name":        "design_dashboard",
						"description": "Guided workflow to design and create an MQTT dashboard from a project description or live broker topics.",
						"arguments": []map[string]any{
							{
								"name":        "project",
								"description": "Description of the IoT project, devices, sensors, and controls.",
								"required":    true,
							},
						},
					},
				},
			},
		}

	case "prompts/get":
		var params struct {
			Name      string            `json:"name"`
			Arguments map[string]string `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil || params.Name != "design_dashboard" {
			return &jsonRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &jsonRPCError{Code: -32602, Message: "Unknown prompt name"},
			}
		}
		projectDesc := params.Arguments["project"]
		doc, _ := BuildSchemaDocumentation("")
		promptText := fmt.Sprintf(
			"Design and create an MQTT Dashboard for the following project:\n\n%s\n\nWorkflow:\n1. Call `list_brokers` and `explore_topics` to check if relevant topics already exist on a connected broker.\n2. Design a well-organized 12-column grid layout using the panel catalog below (include a 'text' header card, 'separator' dividers, monitoring panels like 'gauge'/'graph'/'stats'/'log', and interactive controls like 'toggle'/'slider'/'button'/'cron'/'logic').\n3. Call `create_dashboard` to provision the dashboard directly.\n\nPanel & Grid Schema Reference:\n%s",
			projectDesc, doc,
		)
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"description": "Design and create an MQTT Dashboard",
				"messages": []map[string]any{
					{
						"role": "user",
						"content": map[string]any{
							"type": "text",
							"text": promptText,
						},
					},
				},
			},
		}

	default:
		return &jsonRPCResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &jsonRPCError{Code: -32601, Message: fmt.Sprintf("Method not found: %s", req.Method)},
		}
	}
}
