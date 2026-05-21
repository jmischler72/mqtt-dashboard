import { useCallback, useEffect, useRef, useState } from "react";
import { RiSettings3Line, RiCloseLine } from "react-icons/ri";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import ButtonPanel, {
  ButtonConfigModal,
  type ButtonConfig,
} from "./panels/ButtonPanel";
import InputPanel, {
  InputConfigModal,
  type InputConfig,
} from "./panels/InputPanel";
import LogPanel, { LogConfigModal, type LogConfig } from "./panels/LogPanel";
import CronPanel, {
  CronConfigModal,
  type CronConfig,
} from "./panels/CronPanel";
import { api } from "../api/client";
import type { Panel } from "../pages/DashboardPage";
import type { BrokerStatus } from "../hooks/useBrokers";

interface Props {
  panel: Panel;
  editMode: boolean;
  brokerStatuses: BrokerStatus[];
  activeDashboardId: string;
  highlight?: boolean;
  pickerReturnTopic?: string;
  pickerReturnBrokerId?: string;
  pickerReturnDraftConfig?: unknown;
  onDelete: () => void;
  onUpdate: (p: Panel) => void;
  onConfigModalChange: (panelId: string, isOpen: boolean) => void;
  onPickerConsumed?: () => void;
}

const brokerDotColor: Record<string, string> = {
  CONNECTED: "bg-success",
  CONNECTING: "bg-warning animate-pulse",
  DISCONNECTED: "bg-error",
  ERROR: "bg-error",
  DISABLED: "bg-neutral",
};

type PanelConfig = ButtonConfig | InputConfig | LogConfig | CronConfig;

export default function PanelWrapper({
  panel,
  editMode,
  brokerStatuses,
  activeDashboardId,
  highlight,
  pickerReturnTopic,
  pickerReturnBrokerId,
  pickerReturnDraftConfig,
  onDelete,
  onUpdate,
  onConfigModalChange,
  onPickerConsumed,
}: Props) {
  const navigate = useNavigate();
  const [showConfig, setShowConfig] = useState(false);
  const [capturedPicker, setCapturedPicker] = useState<{
    topic?: string;
    brokerId?: string;
    draftConfig?: unknown;
  }>({});
  const [title, setTitle] = useState(panel.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openConfigTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (openConfigTimeoutRef.current)
        clearTimeout(openConfigTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    onConfigModalChange(panel.id, showConfig);
    return () => onConfigModalChange(panel.id, false);
  }, [onConfigModalChange, panel.id, showConfig]);

  const saveTitle = async () => {
    setEditingTitle(false);
    if (title === panel.title) return;
    try {
      const updated = await api.put<Panel>(`/api/layouts/${panel.id}`, {
        title,
      });
      onUpdate(updated);
    } catch (error) {
      void error;
    }
  };

  const closeConfigModal = useCallback(() => {
    setShowConfig(false);
    setCapturedPicker({});
  }, []);

  // cfg = panel-specific config, brokerId = the broker assignment for this panel
  const saveConfig = async (cfg: PanelConfig, brokerId: string) => {
    closeConfigModal();
    try {
      const updated = await api.put<Panel>(`/api/layouts/${panel.id}`, {
        config_json: cfg,
        broker_id: brokerId,
      });
      onUpdate(updated);

      // If cron panel, also upsert the cron job with broker_id
      if (panel.panel_type === "cron") {
        await api.post(`/api/cron/${panel.id}`, {
          ...cfg,
          broker_id: brokerId,
        });
      }
    } catch (error) {
      void error;
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this panel?")) return;
    try {
      await api.delete(`/api/layouts/${panel.id}`);
      onDelete();
    } catch (error) {
      void error;
    }
  };

  const handleOpenConfig = useCallback(() => {
    const panelEl = panelRef.current;
    if (!panelEl) {
      setShowConfig(true);
      return;
    }

    if (openConfigTimeoutRef.current) {
      clearTimeout(openConfigTimeoutRef.current);
      openConfigTimeoutRef.current = null;
    }

    const rect = panelEl.getBoundingClientRect();
    const margin = 24;
    const outOfView =
      rect.top < margin || rect.bottom > window.innerHeight - margin;

    if (!outOfView) {
      setShowConfig(true);
      return;
    }

    panelEl.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });

    openConfigTimeoutRef.current = setTimeout(() => {
      setShowConfig(true);
      openConfigTimeoutRef.current = null;
    }, 280);
  }, []);

  const onPickerConsumedRef = useRef(onPickerConsumed);
  useEffect(() => {
    onPickerConsumedRef.current = onPickerConsumed;
  });

  useEffect(() => {
    if (pickerReturnTopic === undefined) return;
    const id = setTimeout(() => {
      setCapturedPicker({
        topic: pickerReturnTopic,
        brokerId: pickerReturnBrokerId || undefined,
        draftConfig: pickerReturnDraftConfig,
      });
      handleOpenConfig();
      onPickerConsumedRef.current?.();
    }, 0);
    return () => clearTimeout(id);
  }, [
    pickerReturnTopic,
    pickerReturnBrokerId,
    pickerReturnDraftConfig,
    handleOpenConfig,
  ]);

  const handlePickTopic = ({
    currentTopic,
    selectedBrokerId,
    draftConfig,
  }: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: unknown;
  }) => {
    setShowConfig(false);
    sessionStorage.setItem(
      "topicPickerOutbound",
      JSON.stringify({
        brokerId: selectedBrokerId,
        dashboardId: activeDashboardId,
        panelId: panel.id,
        currentTopic,
        draftConfig,
      }),
    );
    navigate("/explorer");
  };

  const brokerStatus = brokerStatuses.find((bs) => bs.id === panel.broker_id);
  const dotColor =
    brokerDotColor[brokerStatus?.status ?? "DISABLED"] ?? "bg-neutral";

  const renderPanel = () => {
    const cfg = panel.config_json ?? {};
    const brokerId = panel.broker_id ?? "";
    switch (panel.panel_type) {
      case "button":
        return (
          <ButtonPanel
            panelId={panel.id}
            brokerId={brokerId}
            config={cfg as ButtonConfig}
          />
        );
      case "input":
        return <InputPanel brokerId={brokerId} config={cfg as InputConfig} />;
      case "log":
        return (
          <LogPanel
            panelId={panel.id}
            brokerId={brokerId}
            config={cfg as LogConfig}
          />
        );
      case "cron":
        return (
          <CronPanel
            panelId={panel.id}
            brokerId={brokerId}
            config={cfg as CronConfig}
            onConfigChange={(cfg) => saveConfig(cfg, brokerId)}
          />
        );
      default:
        return (
          <div className="flex items-center justify-center h-full text-base-content/40">
            Unknown panel type
          </div>
        );
    }
  };

  const renderConfigModal = () => {
    if (!showConfig) return null;

    const cfg = panel.config_json ?? {};
    const brokerId = panel.broker_id ?? "";
    switch (panel.panel_type) {
      case "button":
        return createPortal(
          <ButtonConfigModal
            config={cfg as ButtonConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={capturedPicker.topic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      case "input":
        return createPortal(
          <InputConfigModal
            config={cfg as InputConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={capturedPicker.topic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      case "log": {
        const logConfig = {
          ...(cfg as LogConfig),
          ...(capturedPicker.draftConfig as Partial<LogConfig> | undefined),
        };
        const existingTopics = logConfig.topics ?? "";
        const logInitialTopic = capturedPicker.topic
          ? existingTopics
            ? `${existingTopics}, ${capturedPicker.topic}`
            : capturedPicker.topic
          : undefined;
        return createPortal(
          <LogConfigModal
            config={logConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={logInitialTopic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      }
      case "cron":
        return createPortal(
          <CronConfigModal
            config={cfg as CronConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={capturedPicker.topic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div
        ref={panelRef}
        className={`flex flex-col h-full bg-base-100 rounded-lg shadow-sm overflow-hidden ${showConfig ? "border-2 border-blue-500" : "border border-base-300"} ${highlight ? "panel-new-highlight" : ""}`}
      >
        {/* Header */}
        <div
          className={`flex items-center gap-2 px-3 py-2 bg-base-200 border-b border-base-300 min-h-10 ${editMode ? "drag-handle cursor-grab active:cursor-grabbing" : ""}`}
        >
          {/* Broker status dot */}
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`}
            title={brokerStatus?.name ?? "No broker"}
          />

          {editingTitle ? (
            <input
              autoFocus
              className="input input-xs flex-1 font-semibold no-drag"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => e.key === "Enter" && saveTitle()}
            />
          ) : (
            <div className="flex-1 min-w-0">
              <span
                className={`inline-block max-w-full font-semibold text-sm truncate ${editMode ? "cursor-text" : ""}`}
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
                <RiSettings3Line className="text-base" />
              </button>
              <button
                className="btn btn-ghost btn-xs text-error no-drag"
                title="Delete"
                onClick={handleDelete}
              >
                <RiCloseLine className="text-base" />
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden p-2">{renderPanel()}</div>
      </div>
      {renderConfigModal()}
    </>
  );
}
