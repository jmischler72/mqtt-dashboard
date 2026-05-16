import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

export interface BrokerStatus {
    id: string
    name: string
    is_enabled: boolean
    status: string
}

export interface Broker {
    id: string
    name: string
    host: string
    port: number
    client_id: string
    username: string
    is_enabled: boolean
    sort_order: number
    status?: string
}

/** Polls /api/brokers/status every 3 seconds. */
export function useBrokerStatuses() {
    const [statuses, setStatuses] = useState<BrokerStatus[]>([])
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        const poll = () =>
            api.get<BrokerStatus[]>('/api/brokers/status')
                .then(setStatuses)
                .catch(() => {})

        poll()
        pollRef.current = setInterval(poll, 3000)
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [])

    return statuses
}
