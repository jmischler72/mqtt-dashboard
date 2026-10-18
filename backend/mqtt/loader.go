package mqtt

import (
	"database/sql"
	"log/slog"

	"mqtt-dashboard/models"
)

// AutoConnectFromDB loads all enabled brokers from the database and connects each one.
func AutoConnectFromDB(database *sql.DB, registry *BrokerRegistry) {
	rows, err := database.Query(`SELECT id, name, host, port, COALESCE(client_id,''), COALESCE(username,''), COALESCE(password,''), is_enabled, sort_order, COALESCE(auth_mode,'none'), tls_enabled, tls_skip_verify, COALESCE(ca_cert,''), COALESCE(client_cert,''), COALESCE(client_key,'') FROM mqtt_brokers WHERE is_enabled = 1 ORDER BY sort_order ASC`)
	if err != nil {
		slog.Error("query enabled brokers", "err", err)
		return
	}
	defer rows.Close()

	isFirst := true
	for rows.Next() {
		var b models.MQTTBroker
		if err := rows.Scan(&b.ID, &b.Name, &b.Host, &b.Port, &b.ClientID, &b.Username, &b.Password, &b.IsEnabled, &b.SortOrder, &b.AuthMode, &b.TLSEnabled, &b.TLSSkipVerify, &b.CACert, &b.ClientCert, &b.ClientKey); err != nil {
			continue
		}
		if err := registry.AddBroker(b); err != nil {
			slog.Error("auto-connect mqtt broker", "broker", b.Name, "err", err)
		}
		if isFirst {
			registry.SetDefault(b.ID)
			isFirst = false
		}
	}
}
