import { useState, useEffect } from 'react'
import { api } from '../../api/client'

interface CronConfig {
    cron_expr?: string
    topic?: string
    payload?: string
    enabled?: boolean
}

// Visual Cron Builder maps friendly options to cron expressions
const PRESETS: { label: string; value: string }[] = [
    { label: 'Every minute', value: '* * * * *' },
    { label: 'Every 5 minutes', value: '*/5 * * * *' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
    { label: 'Every 30 minutes', value: '*/30 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Daily at midnight', value: '0 0 * * *' },
    { label: 'Daily at noon', value: '0 12 * * *' },
    { label: 'Weekly (Sunday midnight)', value: '0 0 * * 0' },
    { label: 'Custom', value: 'custom' },
]

interface Props {
    config: CronConfig
    onSave: (cfg: CronConfig) => void
    onClose: () => void
}

export function CronConfigModal({ config, onSave, onClose }: Props) {
    const [topic, setTopic] = useState(config.topic ?? '')
    const [payload, setPayload] = useState(config.payload ?? '')
    const [enabled, setEnabled] = useState(config.enabled ?? false)
    const [preset, setPreset] = useState('* * * * *')
    const [customExpr, setCustomExpr] = useState(config.cron_expr ?? '')
    const isCustom = preset === 'custom'
    const cronExpr = isCustom ? customExpr : preset

    useEffect(() => {
        if (config.cron_expr) {
            const found = PRESETS.find((p) => p.value === config.cron_expr)
            if (found) setPreset(found.value)
            else { setPreset('custom'); setCustomExpr(config.cron_expr) }
        }
    }, [config.cron_expr])

    return (
        <dialog className="modal modal-open">
            <div className="modal-box max-h-[85vh] overflow-y-auto">
                <h3 className="font-bold text-lg mb-4">Cron Configuration</h3>
                <div className="flex flex-col gap-3">
                    <label className="form-control">
                        <span className="label-text mb-1">Schedule</span>
                        <select className="select select-bordered" value={preset} onChange={(e) => setPreset(e.target.value)}>
                            {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                    </label>
                    {isCustom && (
                        <label className="form-control">
                            <span className="label-text mb-1">Cron Expression (5 fields)</span>
                            <input className="input input-bordered font-mono" placeholder="* * * * *" value={customExpr} onChange={(e) => setCustomExpr(e.target.value)} />
                            <span className="text-xs text-base-content/50 mt-1">min hour day month weekday</span>
                        </label>
                    )}
                    {!isCustom && (
                        <div className="text-xs font-mono bg-base-200 rounded px-3 py-2">
                            Expression: <strong>{cronExpr}</strong>
                        </div>
                    )}
                    <label className="form-control">
                        <span className="label-text mb-1">Topic</span>
                        <input className="input input-bordered" placeholder="home/trigger" value={topic} onChange={(e) => setTopic(e.target.value)} />
                    </label>
                    <label className="form-control">
                        <span className="label-text mb-1">Payload</span>
                        <textarea className="textarea textarea-bordered font-mono" rows={2} placeholder='{"ping": true}' value={payload} onChange={(e) => setPayload(e.target.value)} />
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                        <span className="label-text">Enabled</span>
                        <input type="checkbox" className="toggle toggle-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    </label>
                </div>
                <div className="modal-action">
                    <button className="btn" onClick={onClose}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        disabled={!topic || !cronExpr}
                        onClick={() => onSave({ cron_expr: cronExpr, topic, payload, enabled })}
                    >Save</button>
                </div>
            </div>
            <div className="modal-backdrop" onClick={onClose} />
        </dialog>
    )
}

interface CronPanelProps {
    panelId: string
    config: CronConfig
    onConfigChange: (cfg: CronConfig) => void
}

export default function CronPanel({ panelId, config, onConfigChange }: CronPanelProps) {
    const [nextRun, setNextRun] = useState<Date | null>(null)
    const [countdown, setCountdown] = useState('')
    const [toggling, setToggling] = useState(false)

    const fetchStatus = () => {
        api.get<{ next_run: string }>(`/api/cron/${panelId}`).then((r) => {
            setNextRun(new Date(r.next_run))
        }).catch(() => { })
    }

    useEffect(() => {
        if (config.cron_expr) fetchStatus()
        const interval = setInterval(fetchStatus, 30000)
        return () => clearInterval(interval)
    }, [panelId, config.cron_expr])

    useEffect(() => {
        if (!nextRun) return
        const tick = setInterval(() => {
            const diff = nextRun.getTime() - Date.now()
            if (diff <= 0) {
                setCountdown('now')
                fetchStatus()
                return
            }
            const m = Math.floor(diff / 60000)
            const s = Math.floor((diff % 60000) / 1000)
            setCountdown(`${m}m ${s}s`)
        }, 1000)
        return () => clearInterval(tick)
    }, [nextRun])

    const handleToggle = async (enabled: boolean) => {
        setToggling(true)
        try {
            await api.put(`/api/cron/${panelId}/toggle`, { enabled })
            onConfigChange({ ...config, enabled })
            if (enabled) fetchStatus()
        } catch { }
        setToggling(false)
    }

    const prettyPreset = config.cron_expr
        ? PRESETS.find((p) => p.value === config.cron_expr)?.label ?? config.cron_expr
        : 'Not configured'

    return (
        <div className="flex flex-col gap-3 p-2 h-full">
            <div className="flex items-center justify-between">
                <span className="text-sm font-mono bg-base-200 rounded px-2 py-1">{prettyPreset}</span>
                <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={config.enabled ?? false}
                    disabled={toggling || !config.cron_expr}
                    onChange={(e) => handleToggle(e.target.checked)}
                />
            </div>
            {config.topic && (
                <div className="text-xs text-base-content/60">
                    Topic: <span className="font-mono text-accent">{config.topic}</span>
                </div>
            )}
            {config.enabled && countdown && (
                <div className="text-center">
                    <div className="text-xs text-base-content/50">Next run in</div>
                    <div className="text-2xl font-bold font-mono">{countdown}</div>
                </div>
            )}
            {!config.cron_expr && (
                <div className="text-xs text-base-content/40 text-center mt-auto">Configure via gear icon</div>
            )}
        </div>
    )
}
