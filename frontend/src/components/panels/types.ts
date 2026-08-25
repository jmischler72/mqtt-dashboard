import type { ComponentType, ReactNode } from "react";
import type { BrokerStatus } from "../../hooks/useBrokers";

export type PanelCategory = "monitor" | "control" | "visual";

export interface PanelHeaderMeta {
  topicSummary: string;
  topicDetail?: string;
  payloadPreview?: string;
}

export interface PanelRenderProps<TConfig = Record<string, unknown>> {
  panelId: string;
  brokerId: string;
  config: TConfig;
  onConfigChange?: (newConfig: Partial<TConfig>) => void;
}

export interface PanelConfigModalProps<TConfig = Record<string, unknown>> {
  config: TConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (config: TConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (options: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: unknown;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PanelDefinition<TConfig = any> {
  type: string;
  label: string;
  category: PanelCategory;
  icon: ComponentType<{ size?: number; className?: string }>;

  // Community / Plugin Metadata
  description?: string;
  author?: string;
  version?: string;
  repository?: string;

  // Custom preview JSX mockup (optional; fallback renders metadata card)
  preview?: ReactNode;

  // Layout & Sizing Defaults
  defaultSize?: { w: number; h: number };
  getMinMaxConstraints?: (config: TConfig) => {
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
  };

  // Traits & Warnings
  isVisual?: boolean;
  validateWarning?: (config: TConfig) => string | null;

  // Header Meta customizer
  getHeaderMeta?: (config: TConfig) => Partial<PanelHeaderMeta>;

  // Topic Picker merge strategy (single vs comma-separated multi-topic)
  resolvePickedTopic?: (
    existingTopic: string | undefined,
    pickedTopic: string | undefined,
  ) => string | undefined;

  // Lifecycle hooks
  onSaveConfig?: (
    panelId: string,
    config: TConfig,
    brokerId: string,
  ) => Promise<void> | void;

  // React Components
  Component: ComponentType<PanelRenderProps<TConfig>>;
  ConfigModal: ComponentType<PanelConfigModalProps<TConfig>>;
}
