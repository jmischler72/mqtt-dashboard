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
}

export default function DashboardPage() {
    const [panels, setPanels] = useState<Panel[]>([])
    const [isLoadingLayout, setIsLoadingLayout] = useState(true)
    const [gridWidth, setGridWidth] = useState(1200)
    const [addMenuOpen, setAddMenuOpen] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const addMenuRef = useRef<HTMLDivElement>(null)
    const { editMode } = useOutletContext<LayoutContext>()

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
        const el = containerRef.current
        if (!el) return
        const obs = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width))
        obs.observe(el)
        return () => obs.disconnect()
    }, [])

    useEffect(() => {
        let active = true

        api.get<Panel[]>('/api/layouts')
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
        if (isLoadingLayout) return
        setAddMenuOpen(false)
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
                {isLoadingLayout ? (
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
