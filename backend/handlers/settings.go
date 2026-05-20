package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"mqtt-dashboard/models"
)

// patchSettingsRequest holds optional fields for partial settings updates.
// A nil pointer means "not provided / do not change".
type patchSettingsRequest struct {
	RetentionPeriodHours *int  `json:"retention_period_hours"`
	ShowSysTopics        *bool `json:"show_sys_topics"`
}

type SettingsHandler struct {
	db *sql.DB
}

func NewSettingsHandler(db *sql.DB) *SettingsHandler {
	return &SettingsHandler{db: db}
}

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	var settings models.AppSettings
	row := h.db.QueryRow(`SELECT retention_period_hours, COALESCE(show_sys_topics, 0) FROM app_settings WHERE id = 1`)
	if err := row.Scan(&settings.RetentionPeriodHours, &settings.ShowSysTopics); err != nil {
		settings.RetentionPeriodHours = 24
		settings.ShowSysTopics = false
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
	if _, err := h.db.Exec(`UPDATE app_settings SET retention_period_hours = ?, show_sys_topics = ? WHERE id = 1`, settings.RetentionPeriodHours, settings.ShowSysTopics); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

// PatchSettings performs a partial update: only the fields present in the
// request body are written; omitted fields keep their current DB values.
func (h *SettingsHandler) PatchSettings(w http.ResponseWriter, r *http.Request) {
	var patch patchSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if patch.RetentionPeriodHours == nil && patch.ShowSysTopics == nil {
		http.Error(w, "no fields to update", http.StatusBadRequest)
		return
	}
	if patch.RetentionPeriodHours != nil && *patch.RetentionPeriodHours < 24 {
		http.Error(w, "retention_period_hours must be >= 24", http.StatusBadRequest)
		return
	}

	// Read current values so untouched fields are preserved.
	var current models.AppSettings
	row := h.db.QueryRow(`SELECT retention_period_hours, COALESCE(show_sys_topics, 0) FROM app_settings WHERE id = 1`)
	if err := row.Scan(&current.RetentionPeriodHours, &current.ShowSysTopics); err != nil {
		current.RetentionPeriodHours = 24
		current.ShowSysTopics = false
	}

	if patch.RetentionPeriodHours != nil {
		current.RetentionPeriodHours = *patch.RetentionPeriodHours
	}
	if patch.ShowSysTopics != nil {
		current.ShowSysTopics = *patch.ShowSysTopics
	}

	if _, err := h.db.Exec(`UPDATE app_settings SET retention_period_hours = ?, show_sys_topics = ? WHERE id = 1`,
		current.RetentionPeriodHours, current.ShowSysTopics); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(current)
}
