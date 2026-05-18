package ws_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	mqttclient "mqtt-dashboard/mqtt"
	wspackage "mqtt-dashboard/ws"

	"github.com/gorilla/websocket"
)

// externalMockBrokerSub implements wspackage.BrokerSubscriber for external tests.
type externalMockBrokerSub struct {
	defaultID string
}

func (m *externalMockBrokerSub) Subscribe(brokerID, topic string, handler mqttclient.MessageHandler) error {
	return nil
}

func (m *externalMockBrokerSub) Unsubscribe(brokerID, topic string, handler mqttclient.MessageHandler) {
}

func (m *externalMockBrokerSub) DefaultBrokerID() string {
	return m.defaultID
}

func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	return conn
}

func TestServeWS_Upgrade(t *testing.T) {
	reg := &externalMockBrokerSub{}
	hub := wspackage.NewHub(reg)

	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()

	// Give the server a moment to register the client
	time.Sleep(20 * time.Millisecond)
}

func TestServeWS_SendSubscribeRequest(t *testing.T) {
	reg := &externalMockBrokerSub{defaultID: "broker1"}
	hub := wspackage.NewHub(reg)

	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()

	subReq := wspackage.SubscribeRequest{
		PanelID:  "panel1",
		BrokerID: "broker1",
		Topics:   []string{"sensor/temp"},
	}
	msg, err := json.Marshal(subReq)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Allow server goroutine to process the subscription
	time.Sleep(50 * time.Millisecond)
}

func TestServeWS_ClientDisconnectCloses(t *testing.T) {
	reg := &externalMockBrokerSub{}
	hub := wspackage.NewHub(reg)

	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	conn := dialWS(t, srv)
	// Close immediately — server should handle gracefully
	conn.Close()

	// Give server goroutine a moment to clean up
	time.Sleep(50 * time.Millisecond)
}
