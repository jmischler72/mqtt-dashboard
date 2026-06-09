package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 54 * time.Second
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		u, err := url.Parse(origin)
		if err != nil {
			return false
		}
		return u.Host == r.Host
	},
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade", "err", err)
		return
	}

	c := &Client{
		id:   uuid.New().String(),
		hub:  h,
		send: make(chan WSMessage, 64),
	}
	h.Register(c)
	defer h.Unregister(c)

	// Writer goroutine
	go func() {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for {
			select {
			case msg, ok := <-c.send:
				conn.SetWriteDeadline(time.Now().Add(writeWait)) //nolint
				if !ok {
					conn.WriteMessage(websocket.CloseMessage, []byte{}) //nolint
					return
				}
				b, _ := json.Marshal(msg)
				if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
					return
				}
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(writeWait)) //nolint
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// Reader loop (also handles subscription messages)
	conn.SetReadDeadline(time.Now().Add(pongWait)) //nolint
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait)) //nolint
		return nil
	})
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var subReq SubscribeRequest
		if err := json.Unmarshal(raw, &subReq); err == nil && subReq.PanelID != "" {
			c.panelID = subReq.PanelID
			brokerID := subReq.BrokerID
			if brokerID == "" {
				brokerID = h.registry.DefaultBrokerID()
			}
			h.Subscribe(c, brokerID, subReq.Topics)
		}
	}
}
