import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api/client'
import { useBrokerStatuses } from '../hooks/useBrokers'
import { useWebSocket } from '../hooks/useWebSocket'
import TopicTree from '../components/explorer/TopicTree'
import LogPanel from '../components/panels/LogPanel'
import InputPanel from '../components/panels/InputPanel'

interface WSMessage {
    topic: string
    payload: string
}

interface HistoryRecord {
    id: number
    broker_id: string
    topic: string
    payload: string
    timestamp: string
}

interface LogMessage {
    timestamp: string
    topic: string
    payload: string
    historical?: boolean
}

export default function ExplorerPage() {
    const brokerStatuses = useBrokerStatuses()
    const [selectedBrokerId, setSelectedBrokerId] = useState<string>('')
    const [topics, setTopics] = useState<string[]>([])
    const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
    const [initialHistory, setInitialHistory] = useState<LogMessage[]>([])
    const [liveMessages, setLiveMessages] = useState<WSMessage[]>([])
    const [injectedMessages, setInjectedMessages] = useState<LogMessage[]>([])
    const panelId = useRef('explorer-' + Math.random().toString(36).slice(2))

    // Auto-select first connected broker
    useEffect(() => {
        if (selectedBrokerId || brokerStatuses.length === 0) return
        const first = brokerStatuses.find((b) => b.is_enabled && b.status === 'CONNECTED')
            ?? brokerStatuses.find((b) => b.is_enabled)
            ?? brokerStatuses[0]
        if (first) setSelectedBrokerId(first.id)
    }, [brokerStatuses, selectedBrokerId])

    // Load topic tree when broker changes
    useEffect(() => {
        if (!selectedBrokerId) return
        setTopics([])
        setSelectedTopic(null)
        setLiveMessages([])
        api.getExplorerTree(selectedBrokerId).then(setTopics).catch(() => { })
    }, [selectedBrokerId])

    // Subscribe to # on selected broker via WebSocket
    const { subscribe } = useWebSocket({
        onMessage: (data) => {
            try {
                const msg = JSON.parse(data) as WSMessage
                if (!msg.topic) return
                setLiveMessages((prev) => [...prev.slice(-499), msg])
                // Add new topics to tree as they arrive
                setTopics((prev) => {
                    if (prev.includes(msg.topic)) return prev
                    return [...prev, msg.topic].sort()
                })
            } catch { }
        },
    })

    useEffect(() => {
        if (!selectedBrokerId) return
        subscribe({ panel_id: panelId.current, broker_id: selectedBrokerId, topics: ['#'] })
    }, [selectedBrokerId, subscribe])

    // Load history when topic is selected
    useEffect(() => {
        if (!selectedTopic || !selectedBrokerId) {
            setInitialHistory([])
            setInjectedMessages([])
            return
        }
        api.getExplorerHistory(selectedBrokerId, selectedTopic).then((records: HistoryRecord[]) => {
            const hist: LogMessage[] = records.map((r) => ({
                timestamp: new Date(r.timestamp).toLocaleTimeString(),
                topic: r.topic,
                payload: r.payload,
                historical: true,
            }))
            setInitialHistory(hist)
            setInjectedMessages([])
        }).catch(() => { })
    }, [selectedTopic, selectedBrokerId])

    // Forward live WS messages matching the selected topic to the log panel
    const handleTopicSelect = useCallback((topic: string) => {
        setSelectedTopic(topic)
        setInjectedMessages([])
    }, [])

    // Filter live messages for selected topic and inject into log
    useEffect(() => {
        if (!selectedTopic || liveMessages.length === 0) return
        const latest = liveMessages[liveMessages.length - 1]
        if (latest.topic !== selectedTopic) return
        setInjectedMessages((prev) => [
            ...prev,
            {
                timestamp: new Date().toLocaleTimeString(),
                topic: latest.topic,
                payload: latest.payload,
            },
        ])
    }, [liveMessages, selectedTopic])

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)]">
            {/* ── Header bar ── */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-base-300 bg-base-100 shrink-0">
                <span className="text-sm font-medium text-base-content/60">Broker</span>
                <select
                    className="select select-bordered select-sm"
                    value={selectedBrokerId}
                    onChange={(e) => setSelectedBrokerId(e.target.value)}
                >
                    {brokerStatuses.length === 0 && (
                        <option value="">No brokers configured</option>
                    )}
                    {brokerStatuses.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
                <span className="text-xs text-base-content/40">{topics.length} topics captured</span>
            </div>

            {/* ── Split layout ── */}
            <div className="flex flex-1 overflow-hidden">
                {/* Topic tree */}
                <aside className="w-72 shrink-0 border-r border-base-300 bg-base-100 overflow-hidden flex flex-col">
                    <div className="px-3 py-2 border-b border-base-300 text-xs font-semibold text-base-content/50 uppercase tracking-wider">
                        Topics
                    </div>
                    <TopicTree
                        topics={topics}
                        liveMessages={liveMessages}
                        selectedTopic={selectedTopic}
                        onSelectTopic={handleTopicSelect}
                    />
                </aside>

                {/* Detail panel */}
                <main className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
                    {!selectedTopic ? (
                        <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
                            Select a topic from the tree to inspect its messages
                        </div>
                    ) : (
                        <>
                            <div className="text-xs font-mono text-base-content/50 px-1">
                                <span className="text-accent">{selectedTopic}</span>
                            </div>
                            <div className="flex-1 overflow-hidden min-h-0">
                                <LogPanel
                                    panelId={panelId.current}
                                    brokerId={selectedBrokerId}
                                    config={{ maxMessages: 500, dateFormat: 'time' }}
                                    initialHistory={initialHistory}
                                    injectedMessages={injectedMessages}
                                />
                            </div>
                            <div className="shrink-0">
                                <InputPanel
                                    panelId={panelId.current}
                                    brokerId={selectedBrokerId}
                                    config={{}}
                                    overrideTopic={selectedTopic}
                                    overrideBrokerId={selectedBrokerId}
                                />
                            </div>
                        </>
                    )}
                </main>
            </div>
        </div>
    )
}
