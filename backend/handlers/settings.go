package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"mqtt-dashboard/models"
)

type SettingsHandler struct {
	db *sql.DB
}

func NewSettingsHandler(db *sql.DB) *SettingsHandler {
	return &SettingsHandler{db: db}
}

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	var settings models.AppSettings
	row := h.db.QueryRow(`SELECT retention_period_hours FROM app_settings WHERE id = 1`)
	if err := row.Scan(&settings.RetentionPeriodHours); err != nil {
		settings.RetentionPeriodHours = 24
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
	if _, err := h.db.Exec(`UPDATE app_settings SET retention_period_hours = ? WHERE id = 1`, settings.RetentionPeriodHours); err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}
