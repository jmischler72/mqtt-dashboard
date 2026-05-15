import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../api/client'

type Status = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR'

const dotColor: Record<Status, string> = {
    CONNECTED: 'bg-success',
    DISCONNECTED: 'bg-neutral',
    CONNECTING: 'bg-warning animate-pulse',
    ERROR: 'bg-error',
}

export default function Layout() {
    const [status, setStatus] = useState<Status>('DISCONNECTED')
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        const poll = () => api.get<{ status: Status }>('/api/config/status').then((r) => setStatus(r.status)).catch(() => { })
        poll()
        pollRef.current = setInterval(poll, 3000)
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [])

    return (
        <div className="min-h-screen flex flex-col">
            <nav className="navbar bg-base-100 border-b border-base-300 px-4 gap-4">
                <span className="text-lg font-bold">mqtt-dashboard</span>
                <NavLink to="/dashboard" className={({ isActive }) => `btn btn-sm btn-ghost ${isActive ? 'btn-active' : ''}`}>Dashboard</NavLink>
                <NavLink to="/config" className={({ isActive }) => `btn btn-sm btn-ghost ${isActive ? 'btn-active' : ''}`}>Config</NavLink>
                <div className="ml-auto flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${dotColor[status]}`} />
                    <span className="text-xs text-base-content/60">{status}</span>
                </div>
            </nav>
            <main className="flex-1">
                <Outlet />
            </main>
        </div>
    )
}
