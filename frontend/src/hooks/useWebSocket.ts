import { useEffect, useRef, useCallback } from 'react'

interface UseWebSocketOptions {
    onMessage: (data: string) => void
    onOpen?: () => void
    onClose?: () => void
}

export function useWebSocket(options: UseWebSocketOptions) {
    const ws = useRef<WebSocket | null>(null)
    const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
    const backoff = useRef(1000)
    const unmounted = useRef(false)
    const subscriptionMsg = useRef<string | null>(null)

    const connect = useCallback(() => {
        if (unmounted.current) return
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const socket = new WebSocket(`${proto}://${window.location.host}/ws`)
        ws.current = socket

        socket.onopen = () => {
            backoff.current = 1000
            options.onOpen?.()
            if (subscriptionMsg.current) {
                socket.send(subscriptionMsg.current)
            }
        }

        socket.onmessage = (e) => options.onMessage(e.data)

        socket.onclose = () => {
            options.onClose?.()
            if (!unmounted.current) {
                reconnectTimeout.current = setTimeout(() => {
                    backoff.current = Math.min(backoff.current * 2, 30000)
                    connect()
                }, backoff.current)
            }
        }

        socket.onerror = () => socket.close()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const subscribe = useCallback((msg: object) => {
        const raw = JSON.stringify(msg)
        subscriptionMsg.current = raw
        if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(raw)
        }
    }, [])

    useEffect(() => {
        unmounted.current = false
        connect()
        return () => {
            unmounted.current = true
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
            ws.current?.close()
        }
    }, [connect])

    return { subscribe }
}
