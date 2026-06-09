package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"mqtt-dashboard/models"
)

// SysTopicsSetter is satisfied by BrokerRegistry.
type SysTopicsSetter interface {
	SetSaveSysTopics(v bool)
}

// patchSettingsRequest holds optional fields for partial settings updates.
// A nil pointer means "not provided / do not change".
type patchSettingsRequest struct {
	RetentionPeriodHours *int  `json:"retention_period_hours"`
	SaveSysTopics        *bool `json:"save_sys_topics"`
}

type SettingsHandler struct {
	db       *sql.DB
	registry SysTopicsSetter
}

func NewSettingsHandler(db *sql.DB, registry SysTopicsSetter) *SettingsHandler {
	return &SettingsHandler{db: db, registry: registry}
}

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	var settings models.AppSettings
	row := h.db.QueryRow(`SELECT retention_period_hours, COALESCE(save_sys_topics, 0) FROM app_settings WHERE id = 1`)
	if err := row.Scan(&settings.RetentionPeriodHours, &settings.SaveSysTopics); err != nil {
		settings.RetentionPeriodHours = 24
		settings.SaveSysTopics = false
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func (h *SettingsHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var settings models.AppSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if settings.RetentionPeriodHours < 24 {
		http.Error(w, "retention_period_hours must be >= 24", http.StatusBadRequest)
		return
	}
	if _, err := h.db.Exec(`UPDATE app_settings SET retention_period_hours = ?, save_sys_topics = ? WHERE id = 1`, settings.RetentionPeriodHours, settings.SaveSysTopics); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	h.registry.SetSaveSysTopics(settings.SaveSysTopics)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func (h *SettingsHandler) GetHistorySize(w http.ResponseWriter, r *http.Request) {
	var sizeBytes int64
	row := h.db.QueryRow(`SELECT COALESCE(SUM(pgsize), 0) FROM dbstat WHERE name = 'mqtt_history'`)
	if err := row.Scan(&sizeBytes); err != nil {
		sizeBytes = 0
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int64{"size_bytes": sizeBytes})
}

func (h *SettingsHandler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(`DELETE FROM mqtt_history`); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PatchSettings performs a partial update: only the fields present in the
// request body are written; omitted fields keep their current DB values.
func (h *SettingsHandler) PatchSettings(w http.ResponseWriter, r *http.Request) {
	var patch patchSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if patch.RetentionPeriodHours == nil && patch.SaveSysTopics == nil {
		http.Error(w, "no fields to update", http.StatusBadRequest)
		return
	}
	if patch.RetentionPeriodHours != nil && *patch.RetentionPeriodHours < 24 {
		http.Error(w, "retention_period_hours must be >= 24", http.StatusBadRequest)
		return
	}

	// Read current values so untouched fields are preserved.
	var current models.AppSettings
	row := h.db.QueryRow(`SELECT retention_period_hours, COALESCE(save_sys_topics, 0) FROM app_settings WHERE id = 1`)
	if err := row.Scan(&current.RetentionPeriodHours, &current.SaveSysTopics); err != nil {
		current.RetentionPeriodHours = 24
		current.SaveSysTopics = false
	}

	if patch.RetentionPeriodHours != nil {
		current.RetentionPeriodHours = *patch.RetentionPeriodHours
	}
	if patch.SaveSysTopics != nil {
		current.SaveSysTopics = *patch.SaveSysTopics
	}

	if _, err := h.db.Exec(`UPDATE app_settings SET retention_period_hours = ?, save_sys_topics = ? WHERE id = 1`,
		current.RetentionPeriodHours, current.SaveSysTopics); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	h.registry.SetSaveSysTopics(current.SaveSysTopics)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(current)
}
