import { useState, useEffect, useCallback, useRef } from 'react'
import ReactGridLayout from 'react-grid-layout'
import { useOutletContext } from 'react-router-dom'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RGL = ReactGridLayout as any
import { api } from '../api/client'
import PanelWrapper from '../components/PanelWrapper'

type GridLayout = { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }

export interface Panel {
    id: string
    title: string
    panel_type: string
    x: number
    y: number
    w: number
    h: number
    config_json: Record<string, unknown>
}

const PANEL_TYPES = [
    { value: 'button', label: 'Button' },
    { value: 'input', label: 'Input' },
    { value: 'log', label: 'Log' },
    { value: 'cron', label: 'Cron' },
]

type LayoutContext = {
    editMode: boolean
    setEditMode: React.Dispatch<React.SetStateAction<boolean>>
    activeDashboardId: string
    dashboardsLoading: boolean
}

export default function DashboardPage() {
    const [panels, setPanels] = useState<Panel[]>([])
    const [isLoadingLayout, setIsLoadingLayout] = useState(true)
    const [gridWidth, setGridWidth] = useState(1200)
    const [addMenuOpen, setAddMenuOpen] = useState(false)
    const [openConfigPanels, setOpenConfigPanels] = useState<Set<string>>(new Set())
    const [hasAnyModalOpen, setHasAnyModalOpen] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const addMenuRef = useRef<HTMLDivElement>(null)
    const { editMode, activeDashboardId, dashboardsLoading } = useOutletContext<LayoutContext>()

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
                setAddMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    useEffect(() => {
        const checkAnyModalOpen = () => {
            setHasAnyModalOpen(Boolean(document.querySelector('.modal.modal-open')))
        }

        checkAnyModalOpen()

        const observer = new MutationObserver(checkAnyModalOpen)
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        })

        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const obs = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width))
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    useEffect(() => {
        if (dashboardsLoading || !activeDashboardId) return
        let active = true
        setIsLoadingLayout(true)

        api.get<Panel[]>(`/api/layouts?dashboard_id=${activeDashboardId}`)
            .then((loadedPanels) => {
                if (!active) return
                setPanels(loadedPanels)
            })
            .catch(() => { })
            .finally(() => {
                if (active) setIsLoadingLayout(false)
            })

        return () => {
            active = false
        }
    }, [activeDashboardId, dashboardsLoading])

    const gridInteractionsEnabled = editMode && openConfigPanels.size === 0 && !hasAnyModalOpen

    const layout = panels.map((p) => ({
        i: p.id,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        minW: 2,
        minH: 2,
        static: !gridInteractionsEnabled,
    }))

    const handleLayoutChange = useCallback((newLayout: GridLayout[]) => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            const patches = newLayout.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))
            api.put('/api/layouts/batch', { panels: patches }).catch(() => { })
            setPanels((prev) =>
                prev.map((p) => {
                    const l = newLayout.find((n) => n.i === p.id)
                    return l ? { ...p, x: l.x, y: l.y, w: l.w, h: l.h } : p
                })
            )
        }, 300)
    }, [])

    const addPanel = async (panelType: string) => {
        if (isLoadingLayout || !activeDashboardId) return
        setAddMenuOpen(false)
        try {
            const panel = await api.post<Panel>('/api/layouts', {
                dashboard_id: activeDashboardId,
                panel_type: panelType,
                title: `${PANEL_TYPES.find((t) => t.value === panelType)?.label ?? 'New'} Panel`,
            })
            setPanels((prev) => [...prev, panel])
        } catch { }
    }

    const removePanel = (id: string) => {
        setPanels((prev) => prev.filter((p) => p.id !== id))
    }

    const updatePanel = (updated: Panel) => {
        setPanels((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    }

    const handleConfigModalChange = useCallback((panelId: string, isOpen: boolean) => {
        setOpenConfigPanels((prev) => {
            const next = new Set(prev)
            if (isOpen) {
                next.add(panelId)
            } else {
                next.delete(panelId)
            }
            return next
        })
    }, [])

    return (
        <div className="min-h-screen bg-base-200">
            {editMode && (
                <div className="flex items-center gap-3 px-4 py-2 bg-base-100 border-b border-base-300 sticky top-0 z-10">
                    <div className="relative" ref={addMenuRef}>
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={() => setAddMenuOpen((o) => !o)}
                            disabled={isLoadingLayout}
                        >
                            {isLoadingLayout ? 'Loading layout...' : '+ Add Panel'}
                        </button>
                        {addMenuOpen && !isLoadingLayout && (
                            <ul className="absolute top-full left-0 mt-1 bg-base-100 border border-base-300 rounded-box z-50 w-40 p-2 shadow">
                                {PANEL_TYPES.map((t) => (
                                    <li key={t.value}>
                                        <button className="w-full text-left px-3 py-2 hover:bg-base-200 rounded" onClick={() => addPanel(t.value)}>{t.label}</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {/* Grid */}
            <div className="p-4" ref={containerRef}>
                {dashboardsLoading || isLoadingLayout ? (
                    <div className="flex items-center justify-center h-64 text-base-content/60">
                        <div className="text-center">
                            <span className="loading loading-spinner loading-lg mb-4" />
                            <p className="text-xl">Loading dashboard layout...</p>
                        </div>
                    </div>
                ) : panels.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-base-content/40">
                        <div className="text-center">
                            <p className="text-2xl mb-2">No panels yet</p>
                            <p>{editMode ? 'Click "+ Add Panel" to get started' : 'Toggle Edit: ON in the navbar to add panels'}</p>
                        </div>
                    </div>
                ) : (
                    <div className={hasAnyModalOpen ? 'pointer-events-none' : ''}>
                        <RGL
                            width={gridWidth}
                            layout={layout}
                            cols={12}
                            rowHeight={60}
                            isDraggable={gridInteractionsEnabled}
                            isResizable={gridInteractionsEnabled}
                            onLayoutChange={handleLayoutChange}
                            draggableHandle=".drag-handle"
                            draggableCancel=".no-drag"
                        >
                            {panels.map((panel) => (
                                <div key={panel.id}>
                                    <PanelWrapper
                                        panel={panel}
                                        editMode={editMode}
                                        onDelete={() => removePanel(panel.id)}
                                        onUpdate={updatePanel}
                                        onConfigModalChange={handleConfigModalChange}
                                    />
                                </div>
                            ))}
                        </RGL>
                    </div>
                )}
            </div>
        </div>
    )
}
