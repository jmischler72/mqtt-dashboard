import { useEffect, useRef, useCallback } from "react";

interface UseWebSocketOptions {
  onMessage: (data: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

interface SubscriptionPayload {
  action?: "subscribe" | "unsubscribe";
  panel_id?: string;
  broker_id?: string;
  topics?: string[];
}

export function mqttTopicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  if (!filter.startsWith("$") && topic.startsWith("$")) return false;
  const fp = filter.split("/");
  const tp = topic.split("/");
  for (let i = 0; i < fp.length; i++) {
    if (fp[i] === "#") return true;
    if (fp[i] === "+") {
      if (i >= tp.length) return false;
      continue;
    }
    if (i >= tp.length || fp[i] !== tp[i]) return false;
  }
  return fp.length === tp.length;
}

interface Listener {
  id: string;
  onMessage: (data: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  subscription?: SubscriptionPayload;
}

class WSConnectionManager {
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Listener>();
  private activeSubscriptions = new Map<string, SubscriptionPayload>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private closeTimeout: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private isConnecting = false;

  private connect() {
    if (this.socket || this.isConnecting || this.listeners.size === 0) return;
    this.isConnecting = true;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${window.location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.isConnecting = false;
      this.backoff = 1000;
      this.listeners.forEach((l) => l.onOpen?.());
      // Re-send all active subscriptions on connect / reconnect
      this.activeSubscriptions.forEach((sub) => {
        socket.send(JSON.stringify(sub));
      });
    };

    socket.onmessage = (e) => {
      let parsed: { broker_id?: string; topic?: string } | null = null;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        // Non-JSON frame: forward to all
      }

      this.listeners.forEach((l) => {
        if (!parsed || !l.subscription) {
          l.onMessage(e.data);
          return;
        }
        if (
          l.subscription.broker_id &&
          parsed.broker_id &&
          l.subscription.broker_id !== parsed.broker_id
        ) {
          return;
        }
        if (l.subscription.topics && l.subscription.topics.length > 0) {
          if (!parsed.topic) return;
          const matches = l.subscription.topics.some((filter) =>
            mqttTopicMatches(filter, parsed.topic!)
          );
          if (!matches) return;
        }
        l.onMessage(e.data);
      });
    };

    socket.onclose = () => {
      this.isConnecting = false;
      this.socket = null;
      this.listeners.forEach((l) => l.onClose?.());
      if (this.listeners.size > 0) {
        this.reconnectTimeout = setTimeout(() => {
          this.backoff = Math.min(this.backoff * 2, 30000);
          this.connect();
        }, this.backoff);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  public register(listener: Listener) {
    if (this.closeTimeout) {
      clearTimeout(this.closeTimeout);
      this.closeTimeout = null;
    }
    this.listeners.set(listener.id, listener);
    if (!this.socket && !this.isConnecting) {
      this.connect();
    } else if (this.socket?.readyState === WebSocket.OPEN) {
      listener.onOpen?.();
    }
  }

  public unregister(listenerId: string, panelId?: string) {
    this.listeners.delete(listenerId);
    if (panelId) {
      this.activeSubscriptions.delete(panelId);
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({ action: "unsubscribe", panel_id: panelId })
        );
      }
    }
    if (this.listeners.size === 0) {
      // Debounce closing so React StrictMode or quick navigation doesn't cycle sockets
      this.closeTimeout = setTimeout(() => {
        if (this.listeners.size === 0) {
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
          }
          if (this.socket) {
            this.socket.close();
            this.socket = null;
          }
        }
      }, 100);
    }
  }

  public subscribe(listenerId: string, payload: SubscriptionPayload) {
    const listener = this.listeners.get(listenerId);
    if (listener) {
      listener.subscription = payload;
    }
    if (payload.panel_id) {
      this.activeSubscriptions.set(payload.panel_id, payload);
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}

const wsManager = new WSConnectionManager();

let nextListenerId = 1;

export function useWebSocket(options: UseWebSocketOptions) {
  const listenerIdRef = useRef<string>("");
  if (!listenerIdRef.current) {
    listenerIdRef.current = `ws-sub-${nextListenerId++}`;
  }
  const currentPanelId = useRef<string | undefined>(undefined);

  const onMessageRef = useRef(options.onMessage);
  const onOpenRef = useRef(options.onOpen);
  const onCloseRef = useRef(options.onClose);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
    onOpenRef.current = options.onOpen;
    onCloseRef.current = options.onClose;
  }, [options.onMessage, options.onOpen, options.onClose]);

  useEffect(() => {
    const id = listenerIdRef.current;
    wsManager.register({
      id,
      onMessage: (data) => onMessageRef.current(data),
      onOpen: () => onOpenRef.current?.(),
      onClose: () => onCloseRef.current?.(),
    });

    return () => {
      wsManager.unregister(id, currentPanelId.current);
    };
  }, []);

  const subscribe = useCallback((msg: object) => {
    const payload = msg as SubscriptionPayload;
    if (payload.panel_id) {
      currentPanelId.current = payload.panel_id;
    }
    wsManager.subscribe(listenerIdRef.current, payload);
  }, []);

  return { subscribe };
}
