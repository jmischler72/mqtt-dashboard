import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import DashboardSelector, { type Dashboard } from './DashboardSelector'

type Status = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR'

const dotColor: Record<Status, string> = {
    CONNECTED: 'bg-success',
    DISCONNECTED: 'bg-neutral',
    CONNECTING: 'bg-warning animate-pulse',
    ERROR: 'bg-error',
}

const ACTIVE_DASHBOARD_KEY = 'mqtt_active_dashboard_id'

export default function Layout() {
    const location = useLocation()
    const [status, setStatus] = useState<Status>('DISCONNECTED')
    const [editMode, setEditMode] = useState(false)
    const [dashboards, setDashboards] = useState<Dashboard[]>([])
    const [activeDashboardId, setActiveDashboardId] = useState<string>(() => {
        return localStorage.getItem(ACTIVE_DASHBOARD_KEY) ?? ''
    })
    const [dashboardsLoading, setDashboardsLoading] = useState(true)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        const poll = () => api.get<{ status: Status }>('/api/config/status').then((r) => setStatus(r.status)).catch(() => { })
        poll()
        pollRef.current = setInterval(poll, 3000)
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [])

    useEffect(() => {
        api.get<Dashboard[]>('/api/dashboards').then((list) => {
            setDashboards(list)
            // If stored ID is no longer valid (or empty), default to first
            const stored = localStorage.getItem(ACTIVE_DASHBOARD_KEY)
            const valid = list.find((d) => d.id === stored)
            const defaultId = valid ? stored! : list[0]?.id ?? ''
            setActiveDashboardId(defaultId)
            localStorage.setItem(ACTIVE_DASHBOARD_KEY, defaultId)
        }).catch(() => { }).finally(() => setDashboardsLoading(false))
    }, [])

    const switchDashboard = (id: string) => {
        setActiveDashboardId(id)
        localStorage.setItem(ACTIVE_DASHBOARD_KEY, id)
    }

    const handleCreate = (d: Dashboard) => {
        setDashboards((prev) => [...prev, d])
        switchDashboard(d.id)
    }

    const handleRename = (d: Dashboard) => {
        setDashboards((prev) => prev.map((x) => (x.id === d.id ? d : x)))
    }

    const handleDelete = (id: string) => {
        setDashboards((prev) => {
            const remaining = prev.filter((d) => d.id !== id)
            if (remaining.length > 0) switchDashboard(remaining[0].id)
            return remaining
        })
    }

    const showDashboardControls = location.pathname === '/dashboard'

    return (
        <div className="min-h-screen flex flex-col">
            <nav className="navbar bg-base-100 border-b border-base-300 px-4 gap-4">
                <span className="text-lg font-bold">mqtt-dashboard</span>
                <NavLink to="/dashboard" className={({ isActive }) => `btn btn-sm btn-ghost ${isActive ? 'btn-active' : ''}`}>Dashboard</NavLink>
                <NavLink to="/config" className={({ isActive }) => `btn btn-sm btn-ghost ${isActive ? 'btn-active' : ''}`}>Config</NavLink>
                <div className="ml-auto flex items-center gap-2">
                    {showDashboardControls && dashboards.length > 0 && (
                        <DashboardSelector
                            dashboards={dashboards}
                            activeDashboardId={activeDashboardId}
                            editMode={editMode}
                            onSwitch={switchDashboard}
                            onCreate={handleCreate}
                            onRename={handleRename}
                            onDelete={handleDelete}
                        />
                    )}
                    {showDashboardControls && (
                        <button
                            className={`btn btn-sm ${editMode ? 'btn-warning' : 'btn-outline'}`}
                            onClick={() => setEditMode((prev) => !prev)}
                        >
                            {editMode ? 'Edit: ON' : 'Edit: OFF'}
                        </button>
                    )}
                    <span className={`w-2.5 h-2.5 rounded-full ${dotColor[status]}`} />
                    <span className="text-xs text-base-content/60">{status}</span>
                </div>
            </nav>
            <main className="flex-1">
                <Outlet context={{ editMode, setEditMode, activeDashboardId, dashboardsLoading }} />
            </main>
        </div>
    )
}
