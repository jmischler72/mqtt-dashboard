import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ButtonPanel, { ButtonConfigModal } from './panels/ButtonPanel'
import InputPanel, { InputConfigModal } from './panels/InputPanel'
import LogPanel, { LogConfigModal } from './panels/LogPanel'
import CronPanel, { CronConfigModal } from './panels/CronPanel'
import { api } from '../api/client'
import type { Panel } from '../pages/DashboardPage'

interface Props {
    panel: Panel
    editMode: boolean
    onDelete: () => void
    onUpdate: (p: Panel) => void
    onConfigModalChange: (panelId: string, isOpen: boolean) => void
}

export default function PanelWrapper({ panel, editMode, onDelete, onUpdate, onConfigModalChange }: Props) {
    const [showConfig, setShowConfig] = useState(false)
    const [title, setTitle] = useState(panel.title)
    const [editingTitle, setEditingTitle] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const openConfigTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        return () => {
            if (openConfigTimeoutRef.current) clearTimeout(openConfigTimeoutRef.current)
        }
    }, [])

    useEffect(() => {
        onConfigModalChange(panel.id, showConfig)
        return () => onConfigModalChange(panel.id, false)
    }, [onConfigModalChange, panel.id, showConfig])

    const saveTitle = async () => {
        setEditingTitle(false)
        if (title === panel.title) return
        try {
            const updated = await api.put<Panel>(`/api/layouts/${panel.id}`, { title })
            onUpdate(updated)
        } catch { }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saveConfig = async (cfg: any) => {
        setShowConfig(false)
        try {
            const updated = await api.put<Panel>(`/api/layouts/${panel.id}`, { config_json: cfg })
            onUpdate(updated)

            // If cron panel, also upsert the cron job
            if (panel.panel_type === 'cron') {
                await api.post(`/api/cron/${panel.id}`, cfg)
            }
        } catch { }
    }

    const handleDelete = async () => {
        if (!confirm('Delete this panel?')) return
        try {
            await api.delete(`/api/layouts/${panel.id}`)
            onDelete()
        } catch { }
    }

    const handleOpenConfig = () => {
        const panelEl = panelRef.current
        if (!panelEl) {
            setShowConfig(true)
            return
        }

        if (openConfigTimeoutRef.current) {
            clearTimeout(openConfigTimeoutRef.current)
            openConfigTimeoutRef.current = null
        }

        const rect = panelEl.getBoundingClientRect()
        const margin = 24
        const outOfView = rect.top < margin || rect.bottom > window.innerHeight - margin

        if (!outOfView) {
            setShowConfig(true)
            return
        }

        panelEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })

        openConfigTimeoutRef.current = setTimeout(() => {
            setShowConfig(true)
            openConfigTimeoutRef.current = null
        }, 280)
    }

    const renderPanel = () => {
        const cfg = panel.config_json ?? {}
        switch (panel.panel_type) {
            case 'button':
                return <ButtonPanel panelId={panel.id} config={cfg as any} />
            case 'input':
                return <InputPanel panelId={panel.id} config={cfg as any} />
            case 'log':
                return <LogPanel panelId={panel.id} config={cfg as any} />
            case 'cron':
                return <CronPanel panelId={panel.id} config={cfg as any} onConfigChange={saveConfig} />
            default:
                return <div className="flex items-center justify-center h-full text-base-content/40">Unknown panel type</div>
        }
    }

    const renderConfigModal = () => {
        if (!showConfig) return null
        const cfg = panel.config_json ?? {}
        let modal = null
        switch (panel.panel_type) {
            case 'button':
                modal = <ButtonConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
                break
            case 'input':
                modal = <InputConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
                break
            case 'log':
                modal = <LogConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
                break
            case 'cron':
                modal = <CronConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
                break
            default:
                return null
        }

        return createPortal(modal, document.body)
    }

    return (
        <>
            <div ref={panelRef} className={`flex flex-col h-full bg-base-100 rounded-lg shadow-sm overflow-hidden ${showConfig ? 'border-2 border-blue-500' : 'border border-base-300'}`}>
                {/* Header */}
                <div className={`flex items-center gap-2 px-3 py-2 bg-base-200 border-b border-base-300 min-h-[2.5rem] ${editMode ? 'drag-handle cursor-grab active:cursor-grabbing' : ''}`}>
                    {editingTitle ? (
                        <input
                            autoFocus
                            className="input input-xs flex-1 font-semibold no-drag"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onBlur={saveTitle}
                            onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
                        />
                    ) : (
                        <div className="flex-1 min-w-0">
                            <span
                                className={`inline-block max-w-full font-semibold text-sm truncate ${editMode ? 'cursor-text' : ''}`}
                                onDoubleClick={() => editMode && setEditingTitle(true)}
                            >
                                {title}
                            </span>
                        </div>
                    )}
                    {editMode && (
                        <div className="flex gap-1 shrink-0 no-drag">
                            <button
                                className="btn btn-ghost btn-xs no-drag"
                                title="Configure"
                                onClick={handleOpenConfig}
                            >
                                ⚙
                            </button>
                            <button
                                className="btn btn-ghost btn-xs text-error no-drag"
                                title="Delete"
                                onClick={handleDelete}
                            >
                                ✕
                            </button>
                        </div>
                    )}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-hidden p-2">
                    {renderPanel()}
                </div>
            </div>
            {renderConfigModal()}
        </>
    )
}
