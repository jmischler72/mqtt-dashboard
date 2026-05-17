import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import DashboardSelector, { type Dashboard } from './DashboardSelector'
import { useBrokerStatuses, type BrokerStatus } from '../hooks/useBrokers'

const ACTIVE_DASHBOARD_KEY = 'mqtt_active_dashboard_id'
import { api } from '../api/client'

type AggregatedStatus = 'CONNECTED' | 'PARTIALLY CONNECTED' | 'DISCONNECTED'

function computeAggregated(statuses: BrokerStatus[]): AggregatedStatus {
    const enabled = statuses.filter((s) => s.is_enabled)
    if (enabled.length === 0) return 'DISCONNECTED'
    const connected = enabled.filter((s) => s.status === 'CONNECTED').length
    if (connected === enabled.length) return 'CONNECTED'
    if (connected > 0) return 'PARTIALLY CONNECTED'
    return 'DISCONNECTED'
}

const aggDotColor: Record<AggregatedStatus, string> = {
    CONNECTED: 'bg-success',
    'PARTIALLY CONNECTED': 'bg-warning',
    DISCONNECTED: 'bg-error',
}

const statusDot: Record<string, string> = {
    CONNECTED: 'bg-success',
    CONNECTING: 'bg-warning animate-pulse',
    DISCONNECTED: 'bg-error',
    ERROR: 'bg-error',
    DISABLED: 'bg-neutral',
}

export default function Layout() {
    const location = useLocation()
    const brokerStatuses = useBrokerStatuses()
    const [showCredits, setShowCredits] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [dashboards, setDashboards] = useState<Dashboard[]>([])
    const [activeDashboardId, setActiveDashboardId] = useState<string>(() => {
        return localStorage.getItem(ACTIVE_DASHBOARD_KEY) ?? ''
    })
    const [dashboardsLoading, setDashboardsLoading] = useState(true)
    const [backendReady, setBackendReady] = useState(false)
    const [flyoutOpen, setFlyoutOpen] = useState(false)
    const flyoutRef = useRef<HTMLDivElement>(null)
    const healthRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Health check with retry until backend responds
    useEffect(() => {
        const check = () =>
            api.get('/api/health')
                .then(() => {
                    setBackendReady(true)
                    if (healthRetryRef.current) {
                        clearInterval(healthRetryRef.current)
                        healthRetryRef.current = null
                    }
                })
                .catch(() => { })
        check()
        healthRetryRef.current = setInterval(check, 3000)
        return () => {
            if (healthRetryRef.current) clearInterval(healthRetryRef.current)
        }
    }, [])

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
                setFlyoutOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    useEffect(() => {
        if (!backendReady) return
        api.get<Dashboard[]>('/api/dashboards').then((list) => {
            setDashboards(list)
            const stored = localStorage.getItem(ACTIVE_DASHBOARD_KEY)
            const valid = list.find((d) => d.id === stored)
            const defaultId = valid ? stored! : list[0]?.id ?? ''
            setActiveDashboardId(defaultId)
            localStorage.setItem(ACTIVE_DASHBOARD_KEY, defaultId)
        }).catch(() => { }).finally(() => setDashboardsLoading(false))
    }, [backendReady])

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
    const aggStatus = computeAggregated(brokerStatuses)

    return (
        <div className="min-h-screen flex flex-col">
            <nav className="navbar bg-base-100 border-b border-base-300 px-4 gap-2">
                <img src="/logo.svg" alt="mqtt-dashboard" className="h-8 w-auto mx-2" onClick={() => setShowCredits(!showCredits)} />
                {showCredits && (
                    <div className="modal modal-open">
                        <div className="modal-box max-w-sm">
                            <h3 className="font-bold text-lg mb-4">Credits</h3>
                            <div>
                                <p className="mb-2">This project was made by <a href="https://github.com/jmischler72" target="_blank" className="link">@jmischler72</a> and is open source on <a href="https://github.com/jmischler72/mqtt-dashboard" target="_blank" className="link">GitHub</a>.</p>
                                <p className="mb-2">Thanks for checking it out!</p>
                            </div>
                            <div className="modal-action">
                                <button className="btn btn-sm btn-ghost" onClick={() => setShowCredits(false)}>
                                    Ok
                                </button>
                            </div>
                        </div>
                        <div className="modal-backdrop" onClick={() => setShowCredits(false)} />
                    </div>
                )}
                <NavLink to="/dashboard" className={({ isActive }) => `btn btn-sm btn-ghost ${isActive ? 'btn-active' : ''}`}>Dashboard</NavLink>
                <NavLink to="/explorer" className={({ isActive }) => `btn btn-sm btn-ghost ${isActive ? 'btn-active' : ''}`}>Explorer</NavLink>
                <NavLink to="/config" className={({ isActive }) => `btn btn-sm btn-ghost ${isActive ? 'btn-active' : ''}`}>Configuration</NavLink>
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

                    {/* Aggregated broker status with flyout */}
                    <div className="relative" ref={flyoutRef}>
                        <button
                            className="flex items-center gap-2 btn btn-sm btn-ghost"
                            onClick={() => setFlyoutOpen((o) => !o)}
                        >
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${aggDotColor[aggStatus]}`} />
                            <span className="text-xs text-base-content/60 hidden sm:inline">{aggStatus}</span>
                        </button>

                        {flyoutOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-box shadow-lg w-56 p-2">
                                {brokerStatuses.length === 0 ? (
                                    <p className="text-xs text-base-content/50 px-2 py-1">No brokers configured</p>
                                ) : (
                                    brokerStatuses.map((bs) => (
                                        <div key={bs.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-base-200">
                                            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[bs.status] ?? 'bg-neutral'}`} />
                                            <span className="text-sm flex-1 truncate">{bs.name}</span>
                                            <span className="text-xs text-base-content/50">{bs.status}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </nav>
            <main className="flex-1">
                {!backendReady ? (
                    <div className="flex items-center justify-center h-64 text-base-content/60">
                        <div className="text-center">
                            <span className="loading loading-spinner loading-lg mb-4" />
                            <p className="text-xl">Connecting to backend...</p>
                        </div>
                    </div>
                ) : (
                    <Outlet context={{ editMode, setEditMode, activeDashboardId, dashboardsLoading, brokerStatuses }} />
                )}
            </main>
        </div>
    )
}
