import { useState } from 'react'
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
}

export default function PanelWrapper({ panel, editMode, onDelete, onUpdate }: Props) {
    const [showConfig, setShowConfig] = useState(false)
    const [title, setTitle] = useState(panel.title)
    const [editingTitle, setEditingTitle] = useState(false)

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
        switch (panel.panel_type) {
            case 'button':
                return <ButtonConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
            case 'input':
                return <InputConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
            case 'log':
                return <LogConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
            case 'cron':
                return <CronConfigModal config={cfg as any} onSave={saveConfig} onClose={() => setShowConfig(false)} />
            default:
                return null
        }
    }

    return (
        <div className="flex flex-col h-full bg-base-100 border border-base-300 rounded-lg shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-base-200 border-b border-base-300 min-h-[2.5rem]">
                {editingTitle ? (
                    <input
                        autoFocus
                        className="input input-xs flex-1 font-semibold"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
                    />
                ) : (
                    <span
                        className={`flex-1 font-semibold text-sm truncate ${editMode ? 'cursor-text' : ''}`}
                        onDoubleClick={() => editMode && setEditingTitle(true)}
                    >
                        {title}
                    </span>
                )}
                {editMode && (
                    <div className="flex gap-1 shrink-0">
                        <button
                            className="btn btn-ghost btn-xs"
                            title="Configure"
                            onClick={() => setShowConfig(true)}
                        >
                            ⚙
                        </button>
                        <button
                            className="btn btn-ghost btn-xs text-error"
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

            {renderConfigModal()}
        </div>
    )
}
