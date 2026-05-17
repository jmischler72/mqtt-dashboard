package handlers

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mqtt-dashboard/models"
	mqttclient "mqtt-dashboard/mqtt"
)

type BrokerHandler struct {
	db       *sql.DB
	registry *mqttclient.BrokerRegistry
}

func NewBrokerHandler(db *sql.DB, registry *mqttclient.BrokerRegistry) *BrokerHandler {
	return &BrokerHandler{db: db, registry: registry}
}

// ListBrokers returns all brokers ordered by sort_order, augmented with runtime status.
func (h *BrokerHandler) ListBrokers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, name, host, port, client_id, username, is_enabled, sort_order FROM mqtt_brokers ORDER BY sort_order ASC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	brokers := []models.MQTTBroker{}
	for rows.Next() {
		var b models.MQTTBroker
		if err := rows.Scan(&b.ID, &b.Name, &b.Host, &b.Port, &b.ClientID, &b.Username, &b.IsEnabled, &b.SortOrder); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if b.IsEnabled {
			b.Status = h.registry.Status(b.ID)
		} else {
			b.Status = "DISABLED"
		}
		brokers = append(brokers, b)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(brokers)
}

// CreateBroker adds a new broker and connects it if is_enabled is true.
func (h *BrokerHandler) CreateBroker(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string `json:"name"`
		Host      string `json:"host"`
		Port      string `json:"port"`
		ClientID  string `json:"client_id"`
		Username  string `json:"username"`
		Password  string `json:"password"`
		IsEnabled bool   `json:"is_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if req.Host == "" {
		http.Error(w, "host is required", http.StatusBadRequest)
		return
	}
	port, err := strconv.Atoi(req.Port)
	if err != nil || port < 1 || port > 65535 {
		http.Error(w, "invalid port", http.StatusBadRequest)
		return
	}

	var maxOrder int
	h.db.QueryRow(`SELECT COALESCE(MAX(sort_order), -1) FROM mqtt_brokers`).Scan(&maxOrder) //nolint

	broker := models.MQTTBroker{
		ID:        uuid.New().String(),
		Name:      req.Name,
		Host:      req.Host,
		Port:      port,
		ClientID:  req.ClientID,
		Username:  req.Username,
		Password:  req.Password,
		IsEnabled: req.IsEnabled,
		SortOrder: maxOrder + 1,
	}

	if _, err := h.db.Exec(
		`INSERT INTO mqtt_brokers (id, name, host, port, client_id, username, password, is_enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		broker.ID, broker.Name, broker.Host, broker.Port, broker.ClientID, broker.Username, broker.Password, broker.IsEnabled, broker.SortOrder,
	); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if broker.IsEnabled {
		if err := h.registry.AddBroker(broker); err != nil {
			slog.Error("broker connect on create", "broker", broker.Name, "err", err)
			broker.Status = "ERROR"
		} else {
			broker.Status = h.registry.Status(broker.ID)
		}
		h.updateDefaultBroker()
	} else {
		broker.Status = "DISABLED"
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(broker)
}

// UpdateBroker modifies broker config and manages the connection lifecycle.
func (h *BrokerHandler) UpdateBroker(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Name      *string `json:"name"`
		Host      *string `json:"host"`
		Port      *string `json:"port"`
		ClientID  *string `json:"client_id"`
		Username  *string `json:"username"`
		Password  *string `json:"password"`
		IsEnabled *bool   `json:"is_enabled"`
		SortOrder *int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	row := h.db.QueryRow(`SELECT id, name, host, port, client_id, username, password, is_enabled, sort_order FROM mqtt_brokers WHERE id = ?`, id)
	var b models.MQTTBroker
	if err := row.Scan(&b.ID, &b.Name, &b.Host, &b.Port, &b.ClientID, &b.Username, &b.Password, &b.IsEnabled, &b.SortOrder); err == sql.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	wasEnabled := b.IsEnabled

	if req.Name != nil {
		b.Name = *req.Name
	}
	if req.Host != nil {
		b.Host = *req.Host
	}
	if req.Port != nil {
		p, err := strconv.Atoi(*req.Port)
		if err != nil || p < 1 || p > 65535 {
			http.Error(w, "invalid port", http.StatusBadRequest)
			return
		}
		b.Port = p
	}
	if req.ClientID != nil {
		b.ClientID = *req.ClientID
	}
	if req.Username != nil {
		b.Username = *req.Username
	}
	if req.Password != nil && *req.Password != "" {
		b.Password = *req.Password
	}
	if req.IsEnabled != nil {
		b.IsEnabled = *req.IsEnabled
	}
	if req.SortOrder != nil {
		b.SortOrder = *req.SortOrder
	}

	if _, err := h.db.Exec(
		`UPDATE mqtt_brokers SET name=?, host=?, port=?, client_id=?, username=?, password=?, is_enabled=?, sort_order=? WHERE id=?`,
		b.Name, b.Host, b.Port, b.ClientID, b.Username, b.Password, b.IsEnabled, b.SortOrder, id,
	); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Connection lifecycle management
	if !wasEnabled && b.IsEnabled {
		if err := h.registry.AddBroker(b); err != nil {
			b.Status = "ERROR"
		} else {
			b.Status = h.registry.Status(b.ID)
		}
	} else if wasEnabled && !b.IsEnabled {
		h.registry.RemoveBroker(b.ID)
		b.Status = "DISABLED"
	} else if wasEnabled && b.IsEnabled {
		h.registry.RemoveBroker(b.ID)
		if err := h.registry.AddBroker(b); err != nil {
			b.Status = "ERROR"
		} else {
			b.Status = h.registry.Status(b.ID)
		}
	}

	h.updateDefaultBroker()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(b)
}

// DeleteBroker disconnects and removes a broker.
func (h *BrokerHandler) DeleteBroker(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	h.registry.RemoveBroker(id)
	h.db.Exec(`UPDATE dashboard_layouts SET broker_id = '' WHERE broker_id = ?`, id) //nolint

	res, err := h.db.Exec(`DELETE FROM mqtt_brokers WHERE id = ?`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	h.updateDefaultBroker()
	w.WriteHeader(http.StatusNoContent)
}

// GetBrokersStatus returns per-broker status for the header flyout.
func (h *BrokerHandler) GetBrokersStatus(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(`SELECT id, name, is_enabled FROM mqtt_brokers ORDER BY sort_order ASC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type brokerStatus struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		IsEnabled bool   `json:"is_enabled"`
		Status    string `json:"status"`
	}
	result := []brokerStatus{}
	for rows.Next() {
		var bs brokerStatus
		if err := rows.Scan(&bs.ID, &bs.Name, &bs.IsEnabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if bs.IsEnabled {
			bs.Status = h.registry.Status(bs.ID)
		} else {
			bs.Status = "DISABLED"
		}
		result = append(result, bs)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ReorderBrokers batch-updates sort_order values.
func (h *BrokerHandler) ReorderBrokers(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Brokers []struct {
			ID        string `json:"id"`
			SortOrder int    `json:"sort_order"`
		} `json:"brokers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback() //nolint

	stmt, err := tx.Prepare(`UPDATE mqtt_brokers SET sort_order = ? WHERE id = ?`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	for _, b := range req.Brokers {
		if _, err := stmt.Exec(b.SortOrder, b.ID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.updateDefaultBroker()
	w.WriteHeader(http.StatusNoContent)
}

// updateDefaultBroker sets the registry default to the enabled broker with lowest sort_order.
func (h *BrokerHandler) updateDefaultBroker() {
	var id string
	h.db.QueryRow(`SELECT id FROM mqtt_brokers WHERE is_enabled = 1 ORDER BY sort_order ASC LIMIT 1`).Scan(&id) //nolint
	h.registry.SetDefault(id)
}
