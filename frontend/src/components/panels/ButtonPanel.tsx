import { useState } from 'react'
import { api } from '../../api/client'

interface ButtonConfig {
    label?: string
    topic?: string
    payload?: string
}

interface Props {
    config: ButtonConfig
    onSave: (cfg: ButtonConfig) => void
    onClose: () => void
}

export function ButtonConfigModal({ config, onSave, onClose }: Props) {
    const [label, setLabel] = useState(config.label ?? 'Click')
    const [topic, setTopic] = useState(config.topic ?? '')
    const [payload, setPayload] = useState(config.payload ?? '')

    return (
        <dialog className="modal modal-open">
            <div className="modal-box max-h-[85vh] overflow-y-auto">
                <h3 className="font-bold text-lg mb-4">Button Configuration</h3>
                <div className="flex flex-col gap-3">
                    <label className="form-control">
                        <span className="label-text mb-1">Button Label</span>
                        <input className="input input-bordered" value={label} onChange={(e) => setLabel(e.target.value)} />
                    </label>
                    <label className="form-control">
                        <span className="label-text mb-1">Topic</span>
                        <input className="input input-bordered" placeholder="home/light/switch" value={topic} onChange={(e) => setTopic(e.target.value)} />
                    </label>
                    <label className="form-control">
                        <span className="label-text mb-1">Payload</span>
                        <textarea className="textarea textarea-bordered font-mono" rows={3} placeholder='{"action": "on"}' value={payload} onChange={(e) => setPayload(e.target.value)} />
                    </label>
                </div>
                <div className="modal-action">
                    <button className="btn" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => onSave({ label, topic, payload })}>Save</button>
                </div>
            </div>
            <div className="modal-backdrop" onClick={onClose} />
        </dialog>
    )
}

interface ButtonPanelProps {
    panelId: string
    config: ButtonConfig
}

export default function ButtonPanel({ config }: ButtonPanelProps) {
    const [loading, setLoading] = useState(false)
    const [flash, setFlash] = useState<'success' | 'error' | null>(null)

    const handleClick = async () => {
        if (!config.topic) return
        setLoading(true)
        try {
            await api.post('/api/publish', { topic: config.topic, payload: config.payload ?? '' })
            setFlash('success')
        } catch {
            setFlash('error')
        } finally {
            setLoading(false)
            setTimeout(() => setFlash(null), 1500)
        }
    }

    return (
        <div className="flex items-center justify-center h-full">
            <button
                className={`btn btn-lg ${flash === 'success' ? 'btn-success' : flash === 'error' ? 'btn-error' : 'btn-primary'}`}
                onClick={handleClick}
                disabled={loading || !config.topic}
            >
                {loading ? <span className="loading loading-spinner" /> : (config.label ?? 'Click')}
            </button>
        </div>
    )
}
