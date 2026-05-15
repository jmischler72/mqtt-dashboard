import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

type ConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | 'ERROR'

export default function ConfigPage() {
    const [host, setHost] = useState('')
    const [port, setPort] = useState('1883')
    const [clientId, setClientId] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED')
    const [saving, setSaving] = useState(false)
    const [toast, setToast] = useState<string | null>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        api.get<{ host?: string; port?: number; client_id?: string; username?: string }>('/api/config').then((cfg) => {
            if (cfg.host) setHost(cfg.host)
            if (cfg.port) setPort(String(cfg.port))
            if (cfg.client_id) setClientId(cfg.client_id)
            if (cfg.username) setUsername(cfg.username)
        }).catch(() => { })

        const poll = () => {
            api.get<{ status: ConnectionStatus }>('/api/config/status').then((r) => setStatus(r.status)).catch(() => { })
        }
        poll()
        pollRef.current = setInterval(poll, 3000)
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [])

    const handleSave = async () => {
        setSaving(true)
        try {
            const res = await api.post<{ status: string; error?: string }>('/api/config', {
                host, port, client_id: clientId, username, password,
            })
            setStatus(res.status as ConnectionStatus)
            setToast(res.error ?? 'Configuration saved')
        } catch (e: any) {
            setToast(e.message)
        } finally {
            setSaving(false)
            setTimeout(() => setToast(null), 3000)
        }
    }

    const statusColor: Record<ConnectionStatus, string> = {
        CONNECTED: 'badge-success',
        DISCONNECTED: 'badge-neutral',
        CONNECTING: 'badge-warning',
        ERROR: 'badge-error',
    }

    return (
        <div className="max-w-lg mx-auto mt-10 p-6">
            <h1 className="text-2xl font-bold mb-6">MQTT Configuration</h1>

            <div className="mb-4 flex items-center gap-3">
                <span className="font-medium">Status:</span>
                <span className={`badge ${statusColor[status]}`}>{status}</span>
            </div>

            <div className="flex flex-col gap-4">
                <label className="form-control">
                    <span className="label-text font-medium mb-1">Broker Host</span>
                    <input className="input input-bordered" placeholder="localhost" value={host} onChange={(e) => setHost(e.target.value)} />
                </label>

                <label className="form-control">
                    <span className="label-text font-medium mb-1">Port</span>
                    <input className="input input-bordered" placeholder="1883" value={port} onChange={(e) => setPort(e.target.value)} />
                </label>

                <label className="form-control">
                    <span className="label-text font-medium mb-1">Client ID</span>
                    <input className="input input-bordered" placeholder="mqtt-dashboard" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                </label>

                <label className="form-control">
                    <span className="label-text font-medium mb-1">Username (optional)</span>
                    <input className="input input-bordered" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                </label>

                <label className="form-control">
                    <span className="label-text font-medium mb-1">Password (optional)</span>
                    <input className="input input-bordered" type="password" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>

                <button className="btn btn-primary mt-2" onClick={handleSave} disabled={saving}>
                    {saving ? <span className="loading loading-spinner" /> : null}
                    Save & Connect
                </button>
            </div>

            {toast && (
                <div className="toast toast-top toast-end z-50">
                    <div className="alert alert-info"><span>{toast}</span></div>
                </div>
            )}
        </div>
    )
}
