import { useState } from 'react'
import { api } from '../../api/client'

interface InputConfig {
    topic?: string
    placeholder?: string
    multiline?: boolean
}

interface Props {
    config: InputConfig
    onSave: (cfg: InputConfig) => void
    onClose: () => void
}

export function InputConfigModal({ config, onSave, onClose }: Props) {
    const [topic, setTopic] = useState(config.topic ?? '')
    const [placeholder, setPlaceholder] = useState(config.placeholder ?? '')
    const [multiline, setMultiline] = useState(config.multiline ?? false)

    return (
        <dialog className="modal modal-open">
            <div className="modal-box max-h-[85vh] overflow-y-auto">
                <h3 className="font-bold text-lg mb-4">Input Configuration</h3>
                <div className="flex flex-col gap-3">
                    <fieldset className="fieldset">
                        <legend className="fieldset-legend">Topic</legend>
                        <input className="input input-bordered w-full" placeholder="home/sensor/cmd" value={topic} onChange={(e) => setTopic(e.target.value)} />
                    </fieldset>
                    <fieldset className="fieldset">
                        <legend className="fieldset-legend">Placeholder text</legend>
                        <input className="input input-bordered w-full" placeholder="Enter payload…" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
                    </fieldset>
                    <fieldset className="fieldset">
                        <legend className="fieldset-legend">Mode</legend>
                        <label className="label cursor-pointer justify-start gap-3 px-0">
                            <input type="checkbox" className="toggle toggle-primary" checked={multiline} onChange={(e) => setMultiline(e.target.checked)} />
                            <span className="label-text">Multi-line / JSON mode</span>
                        </label>
                    </fieldset>
                </div>
                <div className="modal-action">
                    <button className="btn" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => onSave({ topic, placeholder, multiline })}>Save</button>
                </div>
            </div>
            <div className="modal-backdrop" onClick={onClose} />
        </dialog>
    )
}

interface InputPanelProps {
    panelId: string
    config: InputConfig
}

export default function InputPanel({ config }: InputPanelProps) {
    const [value, setValue] = useState('')
    const [loading, setLoading] = useState(false)
    const [flash, setFlash] = useState<'success' | 'error' | null>(null)

    const handlePublish = async () => {
        if (!config.topic) return
        setLoading(true)
        try {
            await api.post('/api/publish', { topic: config.topic, payload: value })
            setValue('')
            setFlash('success')
        } catch {
            setFlash('error')
        } finally {
            setLoading(false)
            setTimeout(() => setFlash(null), 1500)
        }
    }

    return (
        <div className="flex flex-col h-full gap-2 p-1">
            {config.multiline ? (
                <textarea
                    className="textarea textarea-bordered font-mono flex-1 resize-none"
                    placeholder={config.placeholder ?? 'Enter payload…'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                />
            ) : (
                <input
                    className="input input-bordered w-full"
                    placeholder={config.placeholder ?? 'Enter payload…'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePublish()}
                />
            )}
            <button
                className={`btn btn-sm ${flash === 'success' ? 'btn-success' : flash === 'error' ? 'btn-error' : 'btn-primary'}`}
                onClick={handlePublish}
                disabled={loading || !config.topic || !value}
            >
                {loading ? <span className="loading loading-spinner loading-xs" /> : 'Publish'}
            </button>
        </div>
    )
}
