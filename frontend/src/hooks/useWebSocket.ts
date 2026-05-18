import { useEffect, useRef, useCallback } from "react";

interface UseWebSocketOptions {
  onMessage: (data: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoff = useRef(1000);
  const unmounted = useRef(false);
  const cancelled = useRef(false);
  const subscriptionMsg = useRef<string | null>(null);
  const onMessageRef = useRef(options.onMessage);
  const onOpenRef = useRef(options.onOpen);
  const onCloseRef = useRef(options.onClose);

  useEffect(() => {
    onMessageRef.current = options.onMessage;
    onOpenRef.current = options.onOpen;
    onCloseRef.current = options.onClose;
  }, [options.onMessage, options.onOpen, options.onClose]);

  const connect = useCallback(function connectImpl() {
    if (unmounted.current || cancelled.current) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${window.location.host}/ws`);
    ws.current = socket;

    socket.onopen = () => {
      if (cancelled.current || unmounted.current) {
        socket.close();
        return;
      }
      backoff.current = 1000;
      onOpenRef.current?.();
      if (subscriptionMsg.current) {
        socket.send(subscriptionMsg.current);
      }
    };

    socket.onmessage = (e) => {
      if (cancelled.current || unmounted.current) return;
      onMessageRef.current(e.data);
    };

    socket.onclose = () => {
      onCloseRef.current?.();
      if (!unmounted.current && !cancelled.current) {
        reconnectTimeout.current = setTimeout(() => {
          backoff.current = Math.min(backoff.current * 2, 30000);
          connectImpl();
        }, backoff.current);
      }
    };

    socket.onerror = () => socket.close();
  }, []);

  const subscribe = useCallback((msg: object) => {
    const raw = JSON.stringify(msg);
    subscriptionMsg.current = raw;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(raw);
    }
  }, []);

  useEffect(() => {
    unmounted.current = false;
    cancelled.current = false;

    // StrictMode-safe: first dev mount is immediately cleaned up,
    // so delaying the connect avoids creating a transient duplicate socket.
    connectTimeout.current = setTimeout(() => {
      if (!cancelled.current && !unmounted.current) connect();
    }, 0);

    return () => {
      cancelled.current = true;
      unmounted.current = true;
      if (connectTimeout.current) clearTimeout(connectTimeout.current);
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      ws.current?.close();
      ws.current = null;
    };
  }, [connect]);

  return { subscribe };
}
