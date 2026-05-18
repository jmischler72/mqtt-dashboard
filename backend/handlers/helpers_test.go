package handlers_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"testing"

	"mqtt-dashboard/db"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.InitDB(":memory:")
	if err != nil {
		t.Fatalf("setup test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func jsonBody(t *testing.T, v any) io.Reader {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("jsonBody marshal: %v", err)
	}
	return bytes.NewReader(b)
}

func decodeJSON[T any](t *testing.T, r io.Reader, target *T) {
	t.Helper()
	if err := json.NewDecoder(r).Decode(target); err != nil {
		t.Fatalf("decodeJSON: %v", err)
	}
}
