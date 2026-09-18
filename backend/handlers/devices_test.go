package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
	"mqtt-dashboard/models"
)

type mockDeviceTracker struct {
	devs       map[string]*models.Device
	scanCalled bool
}

func newMockDeviceTracker() *mockDeviceTracker {
	return &mockDeviceTracker{
		devs: make(map[string]*models.Device),
	}
}

func (m *mockDeviceTracker) GetDevices(brokerID string) []*models.Device {
	var res []*models.Device
	for _, d := range m.devs {
		if d.BrokerID == brokerID {
			cp := *d
			res = append(res, &cp)
		}
	}
	return res
}

func (m *mockDeviceTracker) GetDevice(brokerID, id string) (*models.Device, bool) {
	d, ok := m.devs[brokerID+"\x00"+id]
	if !ok {
		return nil, false
	}
	cp := *d
	return &cp, true
}

func (m *mockDeviceTracker) ScanHistory(brokerID string) error {
	m.scanCalled = true
	return nil
}

func TestDevicesHandler_GetDevices(t *testing.T) {
	tracker := newMockDeviceTracker()
	brokerID := "broker-1"
	tracker.devs[brokerID+"\x00dev-1"] = &models.Device{
		ID:         "dev-1",
		BrokerID:   brokerID,
		Name:       "Test Device",
		Convention: "homie",
		Status:     "online",
	}

	reg := newMockRegistry()
	reg.SetDefault(brokerID)
	h := handlers.NewDevicesHandler(tracker, reg)

	req := httptest.NewRequest(http.MethodGet, "/api/devices?broker_id="+brokerID, nil)
	rec := httptest.NewRecorder()
	h.GetDevices(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var res []*models.Device
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(res) != 1 || res[0].ID != "dev-1" {
		t.Errorf("unexpected devices result: %+v", res)
	}
}

func TestDevicesHandler_GetDevice(t *testing.T) {
	tracker := newMockDeviceTracker()
	brokerID := "broker-1"
	tracker.devs[brokerID+"\x00kitchen-plug"] = &models.Device{
		ID:         "kitchen-plug",
		BrokerID:   brokerID,
		Name:       "Kitchen Smart Plug",
		Convention: "homie",
		Status:     "online",
	}

	reg := newMockRegistry()
	h := handlers.NewDevicesHandler(tracker, reg)

	// Existing device
	r := chi.NewRouter()
	r.Get("/api/devices/{id}", h.GetDevice)

	req := httptest.NewRequest(http.MethodGet, "/api/devices/kitchen-plug?broker_id="+brokerID, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var dev models.Device
	if err := json.NewDecoder(rec.Body).Decode(&dev); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if dev.ID != "kitchen-plug" {
		t.Errorf("expected kitchen-plug, got %s", dev.ID)
	}

	// Non-existing device
	req404 := httptest.NewRequest(http.MethodGet, "/api/devices/nonexistent?broker_id="+brokerID, nil)
	rec404 := httptest.NewRecorder()
	r.ServeHTTP(rec404, req404)
	if rec404.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rec404.Code)
	}
}

func TestDevicesHandler_RestartDevice(t *testing.T) {
	tracker := newMockDeviceTracker()
	brokerID := "broker-1"
	tracker.devs[brokerID+"\x00plug-1"] = &models.Device{
		ID:         "plug-1",
		BrokerID:   brokerID,
		BaseTopic:  "homie/plug-1",
		Convention: "homie",
	}

	reg := newMockRegistry()
	h := handlers.NewDevicesHandler(tracker, reg)

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "plug-1")
	req := httptest.NewRequest(http.MethodPost, "/api/devices/plug-1/restart?broker_id="+brokerID, nil)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rec := httptest.NewRecorder()
	h.RestartDevice(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if len(reg.publishCalls) != 1 {
		t.Fatalf("expected 1 publish call, got %d", len(reg.publishCalls))
	}
	call := reg.publishCalls[0]
	if call.topic != "homie/plug-1/command" || string(call.payload) != "restart" {
		t.Errorf("unexpected publish call: %+v", call)
	}
}

func TestDevicesHandler_PingDevice(t *testing.T) {
	tracker := newMockDeviceTracker()
	brokerID := "broker-1"
	tracker.devs[brokerID+"\x00sensor-1"] = &models.Device{
		ID:         "sensor-1",
		BrokerID:   brokerID,
		BaseTopic:  "sensor-1",
		Convention: "generic",
	}

	reg := newMockRegistry()
	h := handlers.NewDevicesHandler(tracker, reg)

	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "sensor-1")
	req := httptest.NewRequest(http.MethodPost, "/api/devices/sensor-1/ping?broker_id="+brokerID, nil)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rec := httptest.NewRecorder()
	h.PingDevice(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if len(reg.publishCalls) != 1 {
		t.Fatalf("expected 1 publish call, got %d", len(reg.publishCalls))
	}
	call := reg.publishCalls[0]
	if call.topic != "sensor-1/command" || string(call.payload) != "ping" {
		t.Errorf("unexpected publish call: %+v", call)
	}
}

func TestDevicesHandler_SendCommand(t *testing.T) {
	tracker := newMockDeviceTracker()
	brokerID := "broker-1"
	tracker.devs[brokerID+"\x00plug-1"] = &models.Device{
		ID:         "plug-1",
		BrokerID:   brokerID,
		BaseTopic:  "homie/plug-1",
		Convention: "homie",
	}

	reg := newMockRegistry()
	h := handlers.NewDevicesHandler(tracker, reg)

	body := bytes.NewBufferString(`{"payload": "turn_on", "topic": "relay/set"}`)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "plug-1")
	req := httptest.NewRequest(http.MethodPost, "/api/devices/plug-1/command?broker_id="+brokerID, body)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rec := httptest.NewRecorder()
	h.SendCommand(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if len(reg.publishCalls) != 1 {
		t.Fatalf("expected 1 publish call, got %d", len(reg.publishCalls))
	}
	call := reg.publishCalls[0]
	if call.topic != "homie/plug-1/relay/set" || string(call.payload) != "turn_on" {
		t.Errorf("unexpected publish call: %+v", call)
	}
}

func TestDevicesHandler_RescanHistory(t *testing.T) {
	tracker := newMockDeviceTracker()
	brokerID := "broker-1"
	reg := newMockRegistry()
	h := handlers.NewDevicesHandler(tracker, reg)

	req := httptest.NewRequest(http.MethodPost, "/api/devices/rescan?broker_id="+brokerID, nil)
	rec := httptest.NewRecorder()
	h.RescanHistory(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !tracker.scanCalled {
		t.Errorf("expected scanCalled to be true")
	}
}
