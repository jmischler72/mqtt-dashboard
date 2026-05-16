import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable,
    arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '../api/client'
import { useBrokerStatuses, type Broker } from '../hooks/useBrokers'

const statusDot: Record<string, string> = {
    CONNECTED: 'bg-success',
    CONNECTING: 'bg-warning animate-pulse',
    DISCONNECTED: 'bg-error',
    ERROR: 'bg-error',
    DISABLED: 'bg-neutral',
}

// ─── Sortable list item ───────────────────────────────────────────────────────
function BrokerListItem({
    broker,
    status,
    isDefault,
    isSelected,
    onSelect,
    onToggle,
}: {
    broker: Broker
    status: string
    isDefault: boolean
    isSelected: boolean
    onSelect: () => void
    onToggle: (enabled: boolean) => void
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: broker.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-2 px-2 py-2 rounded cursor-pointer select-none ${isSelected ? 'bg-base-300' : 'hover:bg-base-200'}`}
            onClick={onSelect}
        >
            {/* Drag handle */}
            <span
                {...attributes}
                {...listeners}
                className="cursor-grab text-base-content/40 hover:text-base-content/70 touch-none"
                onClick={(e) => e.stopPropagation()}
            >
                ☰
            </span>

            {/* Status dot */}
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[status] ?? 'bg-neutral'}`} />

            {/* Name + default badge */}
            <span className="flex-1 text-sm truncate">{broker.name}</span>
            {isDefault && (
                <span className="badge badge-primary text-xs">Default</span>
            )}

            {/* Enable toggle */}
            <input
                type="checkbox"
                className="toggle toggle-sm toggle-primary no-drag"
                checked={broker.is_enabled}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onToggle(e.target.checked)}
            />
        </div>
    )
}

// ─── Blank form state ─────────────────────────────────────────────────────────
const emptyForm = () => ({
    name: '',
    host: '',
    port: '1883',
    client_id: '',
    username: '',
    password: '',
    is_enabled: true,
})

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ConfigPage() {
    const [brokers, setBrokers] = useState<Broker[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [isCreatingNew, setIsCreatingNew] = useState(false)
    const [selectionInitialized, setSelectionInitialized] = useState(false)
    const [form, setForm] = useState(emptyForm())
    const [saving, setSaving] = useState(false)
    const [isEditingTitle, setIsEditingTitle] = useState(false)
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
    const brokerStatuses = useBrokerStatuses()

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok })
        setTimeout(() => setToast(null), 3000)
    }

    const loadBrokers = useCallback(async () => {
        try {
            const list = await api.get<Broker[]>('/api/brokers')
            setBrokers(list)
        } catch { }
    }, [])

    useEffect(() => { loadBrokers() }, [loadBrokers])

    // Initial selection: default broker when available; otherwise empty state.
    useEffect(() => {
        if (!selectionInitialized) {
            if (brokers.length === 0) {
                setSelectedId(null)
                setIsCreatingNew(false)
                setSelectionInitialized(true)
                return
            }

            const enabled = brokers.filter((b) => b.is_enabled)
            const defaultBroker = enabled[0] ?? brokers[0]
            setSelectedId(defaultBroker.id)
            setIsCreatingNew(false)
            setSelectionInitialized(true)
            return
        }

        if (selectedId && !brokers.some((b) => b.id === selectedId)) {
            const enabled = brokers.filter((b) => b.is_enabled)
            const fallback = enabled[0] ?? brokers[0]
            setSelectedId(fallback?.id ?? null)
            setIsCreatingNew(false)
        }
    }, [brokers, selectionInitialized, selectedId])

    // Populate form from selected broker, or reset for new broker.
    useEffect(() => {
        if (isCreatingNew) {
            setForm(emptyForm())
            return
        }

        if (!selectedId) return
        const b = brokers.find((x) => x.id === selectedId)
        if (!b) return

        setForm({
            name: b.name,
            host: b.host,
            port: String(b.port),
            client_id: b.client_id ?? '',
            username: b.username ?? '',
            password: '',
            is_enabled: b.is_enabled,
        })
    }, [selectedId, isCreatingNew])

    // Keep enable toggle synced with latest server state to avoid stale status in form.
    useEffect(() => {
        if (isCreatingNew || !selectedId) return
        const b = brokers.find((x) => x.id === selectedId)
        if (!b) return
        setForm((prev) => ({ ...prev, is_enabled: b.is_enabled }))
    }, [brokers, selectedId, isCreatingNew])

    const statusById = useMemo(() => {
        const map = new Map<string, string>()
        for (const s of brokerStatuses) map.set(s.id, s.status)
        return map
    }, [brokerStatuses])

    const getBrokerStatus = (broker: Broker) => {
        if (!broker.is_enabled) return 'DISABLED'
        return statusById.get(broker.id) ?? broker.status ?? 'DISCONNECTED'
    }

    const handleAddNew = () => {
        setSelectedId(null)
        setIsCreatingNew(true)
        setIsEditingTitle(false)
        setForm(emptyForm())
    }

    const handleSelect = (id: string) => {
        setSelectedId(id)
        setIsCreatingNew(false)
        setIsEditingTitle(false)
    }

    const handleToggle = async (broker: Broker, enabled: boolean) => {
        try {
            const updated = await api.put<Broker>(`/api/brokers/${broker.id}`, { is_enabled: enabled })
            setBrokers((prev) => prev.map((b) => (b.id === broker.id ? updated : b)))
        } catch (e: any) {
            showToast(e.message, false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            if (isCreatingNew) {
                // Create new
                const payload = {
                    ...form,
                    name: form.name.trim() || 'New Broker',
                }
                const created = await api.post<Broker>('/api/brokers', payload)
                setBrokers((prev) => [...prev, created])
                setSelectedId(created.id)
                setIsCreatingNew(false)
                setIsEditingTitle(false)
                showToast('Broker created')
            } else if (selectedId) {
                // Update existing (only send password if non-empty)
                const payload: Record<string, unknown> = { ...form }
                if (!payload.password) delete payload.password
                const updated = await api.put<Broker>(`/api/brokers/${selectedId}`, payload)
                setBrokers((prev) => prev.map((b) => (b.id === selectedId ? updated : b)))
                setIsEditingTitle(false)
                showToast('Broker saved')
            }
        } catch (e: any) {
            showToast(e.message, false)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!selectedId) return
        const b = brokers.find((x) => x.id === selectedId)
        if (!confirm(`Delete broker "${b?.name}"?`)) return
        try {
            await api.delete(`/api/brokers/${selectedId}`)
            const remaining = brokers.filter((x) => x.id !== selectedId)
            setBrokers(remaining)
            setIsEditingTitle(false)

            if (remaining.length === 0) {
                setSelectedId(null)
                setIsCreatingNew(false)
            } else {
                const enabled = remaining.filter((x) => x.is_enabled)
                setSelectedId((enabled[0] ?? remaining[0]).id)
                setIsCreatingNew(false)
            }
            showToast('Broker deleted')
        } catch (e: any) {
            showToast(e.message, false)
        }
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return

        const oldIndex = brokers.findIndex((b) => b.id === active.id)
        const newIndex = brokers.findIndex((b) => b.id === over.id)
        const reordered = arrayMove(brokers, oldIndex, newIndex).map((b, i) => ({
            ...b,
            sort_order: i,
        }))
        setBrokers(reordered)

        try {
            await api.put('/api/brokers/reorder', {
                brokers: reordered.map((b) => ({ id: b.id, sort_order: b.sort_order })),
            })
        } catch (e: any) {
            showToast(e.message, false)
            loadBrokers() // revert on failure
        }
    }

    const enabledBrokers = brokers.filter((b) => b.is_enabled)
    const disabledBrokers = brokers.filter((b) => !b.is_enabled)
    const defaultBrokerId = enabledBrokers[0]?.id

    const f = (field: keyof typeof form) => ({
        value: form[field] as string,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setForm((prev) => ({ ...prev, [field]: e.target.value })),
    })

    const selectedBroker = selectedId ? brokers.find((b) => b.id === selectedId) : null
    const canShowForm = isCreatingNew || !!selectedBroker
    const titleLabel = isCreatingNew ? 'New Broker' : (selectedBroker?.name ?? 'Broker')
    const titleDisplay = form.name.trim() || titleLabel

    return (
        <div className="flex h-[calc(100vh-4rem)]">
            {/* ── Sidebar ──────────────────────────────────────────── */}
            <aside className="w-64 shrink-0 border-r border-base-300 flex flex-col bg-base-100">
                <div className="p-3 border-b border-base-300">
                    <button className="btn btn-sm btn-primary w-full" onClick={handleAddNew}>
                        + Add New Broker
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        {/* Enabled section */}
                        {enabledBrokers.length > 0 && (
                            <>
                                <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-2 py-1 mt-1">Enabled</p>
                                <SortableContext items={enabledBrokers.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                                    {enabledBrokers.map((b) => (
                                        <BrokerListItem
                                            key={b.id}
                                            broker={b}
                                            status={getBrokerStatus(b)}
                                            isDefault={b.id === defaultBrokerId}
                                            isSelected={b.id === selectedId && !isCreatingNew}
                                            onSelect={() => handleSelect(b.id)}
                                            onToggle={(en) => handleToggle(b, en)}
                                        />
                                    ))}
                                </SortableContext>
                            </>
                        )}

                        {/* Disabled section */}
                        {disabledBrokers.length > 0 && (
                            <>
                                <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-2 py-1 mt-3">Disabled</p>
                                <SortableContext items={disabledBrokers.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                                    {disabledBrokers.map((b) => (
                                        <BrokerListItem
                                            key={b.id}
                                            broker={b}
                                            status={getBrokerStatus(b)}
                                            isDefault={false}
                                            isSelected={b.id === selectedId && !isCreatingNew}
                                            onSelect={() => handleSelect(b.id)}
                                            onToggle={(en) => handleToggle(b, en)}
                                        />
                                    ))}
                                </SortableContext>
                            </>
                        )}

                        {brokers.length === 0 && (
                            <p className="text-sm text-base-content/40 text-center py-8">No brokers yet</p>
                        )}
                    </DndContext>
                </div>
            </aside>

            {/* ── Detail form ──────────────────────────────────────── */}
            <main className="flex-1 overflow-y-auto p-6 flex">
                {!canShowForm ? (
                    <div className="m-auto max-w-md text-center">
                        <h2 className="text-2xl font-semibold mb-2">No broker selected</h2>
                        <p className="text-base-content/60 mb-4">Create a broker from the sidebar to start connecting.</p>
                        <button className="btn btn-primary" onClick={handleAddNew}>+ Add New Broker</button>
                    </div>
                ) : (
                    <div className="w-full max-w-2xl mx-auto my-2">
                        <div className="card bg-base-100 border border-base-300 shadow-sm">
                            <div className="card-body gap-4">
                                <div>
                                    {isEditingTitle ? (
                                        <input
                                            autoFocus
                                            className="input input-bordered input-lg w-full font-semibold"
                                            placeholder={titleLabel}
                                            value={form.name}
                                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                                            onBlur={() => setIsEditingTitle(false)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') setIsEditingTitle(false)
                                            }}
                                        />
                                    ) : (
                                        <button
                                            className="text-left hover:opacity-80 transition-opacity"
                                            onClick={() => setIsEditingTitle(true)}
                                            title="Click to rename broker"
                                        >
                                            <h2 className="text-2xl font-semibold">{titleDisplay}</h2>
                                            <p className="text-xs text-base-content/50 mt-1">Click title to rename</p>
                                        </button>
                                    )}
                                </div>

                                <fieldset className="fieldset">
                                    <legend className="fieldset-legend">Host</legend>
                                    <input
                                        className="input input-bordered w-full"
                                        placeholder="localhost"
                                        {...f('host')}
                                    />
                                </fieldset>

                                <fieldset className="fieldset">
                                    <legend className="fieldset-legend">Port</legend>
                                    <input
                                        className="input input-bordered w-full"
                                        placeholder="1883"
                                        {...f('port')}
                                    />
                                </fieldset>

                                <fieldset className="fieldset">
                                    <legend className="fieldset-legend">Client ID</legend>
                                    <input
                                        className="input input-bordered w-full"
                                        placeholder="mqtt-dashboard"
                                        {...f('client_id')}
                                    />
                                </fieldset>

                                <fieldset className="fieldset">
                                    <legend className="fieldset-legend">Username (optional)</legend>
                                    <input
                                        className="input input-bordered w-full"
                                        placeholder="username"
                                        {...f('username')}
                                    />
                                </fieldset>

                                <fieldset className="fieldset">
                                    <legend className="fieldset-legend">Password (optional)</legend>
                                    <input
                                        className="input input-bordered w-full"
                                        type="password"
                                        placeholder={selectedId ? '(unchanged)' : '••••••'}
                                        {...f('password')}
                                    />
                                </fieldset>

                                <label className="label cursor-pointer justify-start gap-3 px-0 py-2">
                                    <input
                                        type="checkbox"
                                        className="toggle toggle-primary"
                                        checked={form.is_enabled}
                                        onChange={(e) => setForm((prev) => ({ ...prev, is_enabled: e.target.checked }))}
                                    />
                                    <span className="label-text font-medium">Enable this MQTT Server</span>
                                </label>

                                <div className="flex gap-2 mt-1">
                                    <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving}>
                                        {saving ? <span className="loading loading-spinner loading-xs" /> : null}
                                        {isCreatingNew ? 'Create & Connect' : 'Save'}
                                    </button>
                                    {!isCreatingNew && selectedId && (
                                        <button className="btn btn-error btn-outline" onClick={handleDelete}>
                                            Delete
                                        </button>
                                    )}
                                </div>

                                {!isCreatingNew && selectedBroker && (
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={`w-2.5 h-2.5 rounded-full ${statusDot[getBrokerStatus(selectedBroker)] ?? 'bg-neutral'}`} />
                                        <span className="text-sm text-base-content/60">{getBrokerStatus(selectedBroker)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Toast */}
            {toast && (
                <div className="toast toast-top toast-end z-50">
                    <div className={`alert ${toast.ok ? 'alert-success' : 'alert-error'}`}>
                        <span>{toast.msg}</span>
                    </div>
                </div>
            )}
        </div>
    )
}
