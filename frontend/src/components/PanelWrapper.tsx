import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiSettings3Line,
  RiCloseLine,
  RiPushpinLine,
  RiPushpinFill,
  RiServerLine,
  RiHashtag,
  RiErrorWarningLine,
} from "react-icons/ri";
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
import BrokerStatsPanel, {
  BrokerStatsConfigModal,
  type BrokerStatsConfig,
} from "./panels/BrokerStatsPanel";
import SeparatorPanel, {
  SeparatorConfigModal,
  type SeparatorConfig,
} from "./panels/SeparatorPanel";
import TextPanel, {
  TextConfigModal,
  type TextConfig,
} from "./panels/TextPanel";
import ImagePanel, {
  ImageConfigModal,
  type ImageConfig,
} from "./panels/ImagePanel";
import GaugePanel, {
  GaugeConfigModal,
  type GaugeConfig,
} from "./panels/GaugePanel";
import { api } from "../api/client";
import type { Panel } from "../pages/DashboardPage";
import type { BrokerStatus } from "../hooks/useBrokers";
import { buildPanelHeaderMeta } from "./panels/panelHeaderMeta";
import { IoIosArrowDown } from "react-icons/io";

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

type PanelConfig =
  | ButtonConfig
  | InputConfig
  | LogConfig
  | CronConfig
  | BrokerStatsConfig
  | SeparatorConfig
  | TextConfig
  | ImageConfig
  | GaugeConfig;

const VISUAL_PANEL_TYPES = ["image", "separator", "text"];

function getPanelWarning(panelType: string, configJson: unknown): string | null {
  if (["separator", "text", "image"].includes(panelType)) return null;
  const cfg = (configJson ?? {}) as Record<string, unknown>;
  const topic = String(cfg.topic ?? cfg.topics ?? "").trim();

  if (!topic) {
    return "No topic configured";
  }

  if (["button", "input", "cron"].includes(panelType)) {
    const topicsList = topic.split(",").map((t) => t.trim()).filter(Boolean);
    if (topicsList.some((t) => t.includes("+") || t.includes("#"))) {
      return "Cannot publish to wildcard topics (+ or #)";
    }
  }

  return null;
}

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
  const panelWarning = getPanelWarning(panel.panel_type, panel.config_json);
  const [showConfig, setShowConfig] = useState(false);
  const [capturedPicker, setCapturedPicker] = useState<{
    topic?: string;
    brokerId?: string;
    draftConfig?: unknown;
  }>({});
  const [title, setTitle] = useState(panel.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [isMetaRegionHovered, setIsMetaRegionHovered] = useState(false);
  const [isTopicSummaryHovered, setIsTopicSummaryHovered] = useState(false);
  const [isPayloadHovered, setIsPayloadHovered] = useState(false);
  const [topicPopoverPos, setTopicPopoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [payloadPopoverPos, setPayloadPopoverPos] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [optimisticPinned, setOptimisticPinned] = useState<boolean | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const topicAnchorRef = useRef<HTMLDivElement>(null);
  const payloadAnchorRef = useRef<HTMLDivElement>(null);
  const openConfigTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const closeMetaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const topicLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const payloadLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const openCfg = openConfigTimeoutRef;
    const closeMeta = closeMetaTimeoutRef;
    const topicLeave = topicLeaveTimerRef;
    const payloadLeave = payloadLeaveTimerRef;
    return () => {
      if (openCfg.current) clearTimeout(openCfg.current);
      if (closeMeta.current) clearTimeout(closeMeta.current);
      if (topicLeave.current) clearTimeout(topicLeave.current);
      if (payloadLeave.current) clearTimeout(payloadLeave.current);
    };
  }, []);

  const handleMetaRegionEnter = () => {
    if (closeMetaTimeoutRef.current) {
      clearTimeout(closeMetaTimeoutRef.current);
      closeMetaTimeoutRef.current = null;
    }
    setIsMetaRegionHovered(true);
  };

  const handleMetaRegionLeave = () => {
    if (closeMetaTimeoutRef.current) clearTimeout(closeMetaTimeoutRef.current);
    closeMetaTimeoutRef.current = setTimeout(() => {
      setIsMetaRegionHovered(false);
      closeMetaTimeoutRef.current = null;
    }, 180);
  };

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
      const currentCfg = (panel.config_json ?? {}) as Record<string, unknown>;
      const nextCfg = {
        ...(cfg as Record<string, unknown>),
        ...(currentCfg.header_meta_pinned !== undefined
          ? { header_meta_pinned: currentCfg.header_meta_pinned }
          : {}),
      };
      const updated = await api.put<Panel>(`/api/layouts/${panel.id}`, {
        config_json: nextCfg,
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
  const panelConfig = (panel.config_json ?? {}) as Record<string, unknown>;
  const persistedPinned = panelConfig.header_meta_pinned === true;
  const isPinned = optimisticPinned ?? persistedPinned;
  const headerMeta = buildPanelHeaderMeta(panel.panel_type, panelConfig);
  const isVisual = VISUAL_PANEL_TYPES.includes(panel.panel_type);
  const isSeparator = panel.panel_type === "separator";
  const sepOrientation =
    (panelConfig as { orientation?: string })?.orientation ?? "horizontal";
  const showMetaPopover =
    !isVisual &&
    (isPinned ||
      isMetaRegionHovered ||
      isTopicSummaryHovered ||
      isPayloadHovered);

  const updateMetaPinned = async (nextPinned: boolean) => {
    if (nextPinned === isPinned) return;
    setOptimisticPinned(nextPinned);
    try {
      const updated = await api.put<Panel>(`/api/layouts/${panel.id}`, {
        config_json: {
          ...panelConfig,
          header_meta_pinned: nextPinned,
        },
      });
      onUpdate(updated);
      setOptimisticPinned(null);
    } catch (error) {
      void error;
      setOptimisticPinned(persistedPinned);
    }
  };

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
            onConfigChange={(newCfg) => {
              const currentCfg = (panel.config_json ?? {}) as Record<
                string,
                unknown
              >;
              const nextCfg = {
                ...currentCfg,
                ...(newCfg as Record<string, unknown>),
              };
              onUpdate({
                ...panel,
                config_json: nextCfg,
              });
            }}
          />
        );
      case "stats":
        return (
          <BrokerStatsPanel
            panelId={panel.id}
            brokerId={brokerId}
            config={cfg as BrokerStatsConfig}
          />
        );
      case "gauge":
        return (
          <GaugePanel
            panelId={panel.id}
            brokerId={brokerId}
            config={cfg as GaugeConfig}
          />
        );
      case "separator":
        return <SeparatorPanel config={cfg as SeparatorConfig} />;
      case "text":
        return <TextPanel config={cfg as TextConfig} />;
      case "image":
        return <ImagePanel config={cfg as ImageConfig} />;
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

    const resolvePickedTopic = (
      existingTopic: string | undefined,
      pickedTopic: string | undefined,
    ): string | undefined => {
      if (!pickedTopic) return undefined;
      if (!existingTopic || !existingTopic.trim()) return pickedTopic;
      const existingList = existingTopic
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const pickedList = pickedTopic
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const merged = Array.from(new Set([...existingList, ...pickedList]));
      return merged.join(", ");
    };

    switch (panel.panel_type) {
      case "button": {
        const buttonConfig = {
          ...(cfg as ButtonConfig),
          ...(capturedPicker.draftConfig as Partial<ButtonConfig> | undefined),
        };
        const buttonInitialTopic = resolvePickedTopic(
          buttonConfig.topic,
          capturedPicker.topic,
        );
        return createPortal(
          <ButtonConfigModal
            config={buttonConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={buttonInitialTopic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      }
      case "input": {
        const inputConfig = {
          ...(cfg as InputConfig),
          ...(capturedPicker.draftConfig as Partial<InputConfig> | undefined),
        };
        const inputInitialTopic = resolvePickedTopic(
          inputConfig.topic,
          capturedPicker.topic,
        );
        return createPortal(
          <InputConfigModal
            config={inputConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={inputInitialTopic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      }
      case "log": {
        const logConfig = {
          ...(cfg as LogConfig),
          ...(capturedPicker.draftConfig as Partial<LogConfig> | undefined),
        };
        const logInitialTopic = resolvePickedTopic(
          logConfig.topics,
          capturedPicker.topic,
        );
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
      case "cron": {
        const cronConfig = {
          ...(cfg as CronConfig),
          ...(capturedPicker.draftConfig as Partial<CronConfig> | undefined),
        };
        const cronInitialTopic = resolvePickedTopic(
          cronConfig.topic,
          capturedPicker.topic,
        );
        return createPortal(
          <CronConfigModal
            config={cronConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={cronInitialTopic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      }
      case "stats": {
        const statsConfig = {
          ...(cfg as BrokerStatsConfig),
          ...(capturedPicker.draftConfig as
            | Partial<BrokerStatsConfig>
            | undefined),
        };
        const statsInitialTopic = resolvePickedTopic(
          statsConfig.topic,
          capturedPicker.topic,
        );
        return createPortal(
          <BrokerStatsConfigModal
            config={statsConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={statsInitialTopic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      }
      case "gauge": {
        const gaugeConfig = {
          ...(cfg as GaugeConfig),
          ...(capturedPicker.draftConfig as Partial<GaugeConfig> | undefined),
        };
        const gaugeInitialTopic =
          capturedPicker.topic || gaugeConfig.topic;
        return createPortal(
          <GaugeConfigModal
            config={gaugeConfig}
            brokerId={brokerId}
            brokerStatuses={brokerStatuses}
            onSave={(c, bid) => saveConfig(c, bid)}
            onClose={closeConfigModal}
            onPickTopic={handlePickTopic}
            initialTopic={gaugeInitialTopic}
            initialBrokerId={capturedPicker.brokerId}
          />,
          document.body,
        );
      }
      case "separator":
        return createPortal(
          <SeparatorConfigModal
            config={cfg as SeparatorConfig}
            onSave={(c) => saveConfig(c, "")}
            onClose={closeConfigModal}
          />,
          document.body,
        );
      case "text":
        return createPortal(
          <TextConfigModal
            config={cfg as TextConfig}
            onSave={(c) => saveConfig(c, "")}
            onClose={closeConfigModal}
          />,
          document.body,
        );
      case "image":
        return createPortal(
          <ImageConfigModal
            config={cfg as ImageConfig}
            onSave={(c) => saveConfig(c, "")}
            onClose={closeConfigModal}
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
        className={
          isSeparator && !editMode
            ? `relative ${sepOrientation === "horizontal" ? "h-1/2 w-full" : "w-1/2 h-full"} overflow-hidden ${highlight ? "panel-new-highlight rounded-lg" : ""}`
            : `flex flex-col h-full bg-base-100 rounded-lg shadow-sm overflow-hidden ${showConfig ? "border-2 border-blue-500" : "border border-base-300"} ${highlight ? "panel-new-highlight" : ""}`
        }
      >
        {/* Header — hidden for visual panels in view mode */}
        {(!isVisual || editMode) && (
          <div
            className={`flex items-center gap-2 px-3 py-2 bg-base-200 border-b border-base-300 min-h-10 ${editMode ? "drag-handle cursor-grab active:cursor-grabbing" : ""}`}
          >
            {!isVisual && (
              <div
                data-testid="panel-meta-anchor"
                className="shrink-0 no-drag flex items-center gap-1 px-1 py-1 rounded-full"
                onMouseEnter={handleMetaRegionEnter}
                onMouseLeave={handleMetaRegionLeave}
              >
                <button
                  type="button"
                  aria-label="Broker status details"
                  className={`w-2 h-2 rounded-full ${dotColor} ${brokerStatus?.status === "CONNECTED" ? "status-dot-hover-hint" : ""}`}
                  onClick={(e) => e.stopPropagation()}
                />
                <div
                  className="transition-transform"
                  style={{
                    transform: showMetaPopover
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                  }}
                >
                  {!isPinned && <IoIosArrowDown />}
                </div>
              </div>
            )}

            {editingTitle ? (
              <input
                autoFocus
                className="input input-xs flex-1 font-semibold no-drag"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                onMouseDown={(e) => e.stopPropagation()}
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
            {editMode ? (
              <div className="flex items-center gap-1 shrink-0 no-drag">
                {panelWarning && (
                  <span
                    className="text-warning flex items-center gap-1 text-xs font-medium cursor-help px-1.5 py-0.5 rounded-sm bg-warning/10 border border-warning/30"
                    title="Configuration warning — check panel parameters"
                  >
                    <RiErrorWarningLine className="text-warning text-sm shrink-0" />
                  </span>
                )}
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
            ) : (
              panelWarning && (
                <div className="flex items-center gap-1 shrink-0 no-drag">
                  <span
                    className="text-warning flex items-center gap-1 text-xs font-medium cursor-help px-1.5 py-0.5 rounded-sm bg-warning/10 border border-warning/30"
                    title="Configuration warning — check panel parameters"
                  >
                    <RiErrorWarningLine className="text-warning text-sm shrink-0" />
                  </span>
                </div>
              )
            )}
          </div>
        )}

        {showMetaPopover && (
          <div
            className="flex items-center gap-2 px-3 py-1 bg-base-100 border-b border-base-300 text-[11px] no-drag"
            onMouseEnter={handleMetaRegionEnter}
            onMouseLeave={handleMetaRegionLeave}
          >
            <span className="inline-flex items-center gap-1 min-w-0">
              <RiServerLine className="shrink-0 text-base-content/65" />
              <span
                className="truncate"
                title={brokerStatus?.name ?? "No broker"}
              >
                {brokerStatus?.name ?? "No broker"}
              </span>
            </span>

            <span className="text-base-content/35">|</span>

            <span className="inline-flex items-center gap-1 min-w-0 flex-1">
              <RiHashtag className="shrink-0 text-base-content/65" />
              {headerMeta.topicDetail ? (
                <div
                  ref={topicAnchorRef}
                  className="min-w-0 flex-1 no-drag"
                  onMouseEnter={() => {
                    if (topicLeaveTimerRef.current) {
                      clearTimeout(topicLeaveTimerRef.current);
                      topicLeaveTimerRef.current = null;
                    }
                    setIsTopicSummaryHovered(true);
                    if (topicAnchorRef.current) {
                      const rect =
                        topicAnchorRef.current.getBoundingClientRect();
                      const POPOVER_WIDTH = 240;
                      const top = rect.bottom + 4;
                      let left = rect.left;
                      if (left + POPOVER_WIDTH > window.innerWidth - 8) {
                        left = window.innerWidth - POPOVER_WIDTH - 8;
                      }
                      setTopicPopoverPos({ top, left });
                    }
                  }}
                  onMouseLeave={() => {
                    topicLeaveTimerRef.current = setTimeout(() => {
                      setIsTopicSummaryHovered(false);
                      topicLeaveTimerRef.current = null;
                    }, 150);
                  }}
                >
                  <span className="block truncate text-[10px] underline decoration-dotted cursor-default">
                    {headerMeta.topicSummary}
                  </span>
                </div>
              ) : (
                <span
                  className="block truncate"
                  title={headerMeta.topicSummary}
                >
                  {headerMeta.topicSummary}
                </span>
              )}
            </span>

            {headerMeta.payloadPreview && (
              <div
                ref={payloadAnchorRef}
                className="shrink-0 no-drag"
                onMouseEnter={() => {
                  if (payloadLeaveTimerRef.current) {
                    clearTimeout(payloadLeaveTimerRef.current);
                    payloadLeaveTimerRef.current = null;
                  }
                  setIsPayloadHovered(true);
                  if (payloadAnchorRef.current) {
                    const rect =
                      payloadAnchorRef.current.getBoundingClientRect();
                    const top = rect.bottom + 4;
                    // Anchor by the right edge so the popover stays aligned
                    // with the "Payload" label regardless of its content width.
                    // Clamp so neither edge escapes the viewport: the popover
                    // can grow up to POPOVER_MAX_WIDTH (max-w-60 = 240px).
                    const POPOVER_MAX_WIDTH = 240;
                    const maxRight = Math.max(
                      8,
                      window.innerWidth - POPOVER_MAX_WIDTH - 20, // 20 = some extra margin
                    );
                    const right = Math.min(
                      maxRight,
                      Math.max(8, window.innerWidth - rect.right),
                    );
                    setPayloadPopoverPos({ top, right });
                  }
                }}
                onMouseLeave={() => {
                  payloadLeaveTimerRef.current = setTimeout(() => {
                    setIsPayloadHovered(false);
                    payloadLeaveTimerRef.current = null;
                  }, 150);
                }}
              >
                <span className="text-[10px] text-base-content/60 underline decoration-dotted cursor-default">
                  Payload
                </span>
              </div>
            )}

            <button
              type="button"
              aria-label={
                isPinned ? "Unpin broker metadata" : "Pin broker metadata"
              }
              className="btn btn-ghost btn-xs h-6 min-h-6 w-6 px-0 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                void updateMetaPinned(!isPinned);
              }}
            >
              {isPinned ? <RiPushpinFill /> : <RiPushpinLine />}
            </button>
          </div>
        )}

        {/* Body blocks drag-start events so only header can move panels. */}
        <div
          className={`overflow-hidden no-drag ${isSeparator && !editMode ? "h-full w-full" : "flex-1 p-2"}`}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onMouseDownCapture={(e) => e.stopPropagation()}
          onTouchStartCapture={(e) => e.stopPropagation()}
        >
          {renderPanel()}
        </div>
      </div>
      {renderConfigModal()}
      {isTopicSummaryHovered &&
        topicPopoverPos &&
        createPortal(
          <div
            className="fixed z-50 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
            style={{ top: topicPopoverPos.top, left: topicPopoverPos.left }}
            onMouseEnter={() => {
              if (topicLeaveTimerRef.current) {
                clearTimeout(topicLeaveTimerRef.current);
                topicLeaveTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              topicLeaveTimerRef.current = setTimeout(() => {
                setIsTopicSummaryHovered(false);
                topicLeaveTimerRef.current = null;
              }, 150);
            }}
          >
            <pre className="text-[11px] leading-tight font-mono whitespace-pre-wrap break-all max-h-28 overflow-auto max-w-60">
              {headerMeta.topicDetail}
            </pre>
          </div>,
          document.body,
        )}
      {isPayloadHovered &&
        payloadPopoverPos &&
        createPortal(
          <div
            className="fixed z-50 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
            style={{
              top: payloadPopoverPos.top,
              right: payloadPopoverPos.right,
            }}
            onMouseEnter={() => {
              if (payloadLeaveTimerRef.current) {
                clearTimeout(payloadLeaveTimerRef.current);
                payloadLeaveTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              payloadLeaveTimerRef.current = setTimeout(() => {
                setIsPayloadHovered(false);
                payloadLeaveTimerRef.current = null;
              }, 150);
            }}
          >
            <pre className="text-[11px] font-mono whitespace-pre-wrap max-h-28 overflow-auto max-w-60">
              {headerMeta.payloadPreview}
            </pre>
          </div>,
          document.body,
        )}
    </>
  );
}
