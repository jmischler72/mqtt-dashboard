import { useState, useEffect, useCallback, useRef } from 'react'
import ReactGridLayout from 'react-grid-layout'
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

export default function DashboardPage() {
    const [panels, setPanels] = useState<Panel[]>([])
    const [editMode, setEditMode] = useState(false)
    const [gridWidth, setGridWidth] = useState(1200)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const obs = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width))
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    useEffect(() => {
        api.get<Panel[]>('/api/layouts').then(setPanels).catch(() => { })
    }, [])

    const layout = panels.map((p) => ({
        i: p.id,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        minW: 2,
        minH: 3,
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
        try {
            const panel = await api.post<Panel>('/api/layouts', {
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

    return (
        <div className="min-h-screen bg-base-200">
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-4 py-2 bg-base-100 border-b border-base-300 sticky top-0 z-10">
                <div className="dropdown">
                    <button className="btn btn-sm btn-primary">+ Add Panel</button>
                    <ul className="dropdown-content menu bg-base-100 rounded-box z-50 w-40 p-2 shadow">
                        {PANEL_TYPES.map((t) => (
                            <li key={t.value}><a onClick={() => addPanel(t.value)}>{t.label}</a></li>
                        ))}
                    </ul>
                </div>
                <label className="flex items-center gap-2 cursor-pointer ml-auto">
                    <span className="text-sm">{editMode ? '🔓 Edit Mode' : '🔒 Locked'}</span>
                    <input type="checkbox" className="toggle toggle-sm toggle-primary" checked={editMode} onChange={(e) => setEditMode(e.target.checked)} />
                </label>
            </div>

            {/* Grid */}
            <div className="p-4" ref={containerRef}>
                {panels.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-base-content/40">
                        <div className="text-center">
                            <p className="text-2xl mb-2">No panels yet</p>
                            <p>Click "+ Add Panel" to get started</p>
                        </div>
                    </div>
                ) : (
                    <RGL
                        width={gridWidth}
                        layout={layout}
                        cols={12}
                        rowHeight={60}
                        isDraggable={editMode}
                        isResizable={editMode}
                        onLayoutChange={handleLayoutChange}
                        draggableHandle=".drag-handle"
                    >
                        {panels.map((panel) => (
                            <div key={panel.id}>
                                {editMode && (
                                    <div className="drag-handle absolute top-0 left-0 right-0 h-2 cursor-grab active:cursor-grabbing bg-primary/20 rounded-t z-10" />
                                )}
                                <PanelWrapper
                                    panel={panel}
                                    editMode={editMode}
                                    onDelete={() => removePanel(panel.id)}
                                    onUpdate={updatePanel}
                                />
                            </div>
                        ))}
                    </RGL>
                )}
            </div>
        </div>
    )
}
