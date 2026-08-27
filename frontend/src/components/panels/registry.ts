import type {
  EmptyStateInfo,
  PanelCategory,
  PanelDefinition,
  PanelHeaderMeta,
  ValidationResult,
} from "./types";

const registry = new Map<string, PanelDefinition>();

export function registerPanel(definition: PanelDefinition): void {
  registry.set(definition.type, definition);
}

export function getPanelDefinition(type: string): PanelDefinition | undefined {
  return registry.get(type);
}

export function getAllPanels(): PanelDefinition[] {
  return Array.from(registry.values());
}

export function getPanelsByCategory(
  category: PanelCategory,
): PanelDefinition[] {
  return getAllPanels().filter((p) => p.category === category);
}

export function defaultResolvePickedTopic(
  existingTopic: string | undefined,
  pickedTopic: string | undefined,
): string | undefined {
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
}

export function defaultValidateConfig(
  def: PanelDefinition | undefined,
  configJson: unknown,
): ValidationResult {
  if (!def || def.isVisual) {
    return { isValid: true };
  }

  if (def.validateConfig) {
    return def.validateConfig(configJson as Record<string, unknown>);
  }

  if (def.validateWarning) {
    const warning = def.validateWarning(configJson as Record<string, unknown>);
    return {
      isValid: !warning,
      warning,
      errors: warning ? { general: warning } : undefined,
    };
  }

  const cfg = (configJson ?? {}) as Record<string, unknown>;
  const topic = String(cfg.topic ?? cfg.topics ?? "").trim();

  if (!topic) {
    return {
      isValid: false,
      warning: "No topic configured",
      errors: { topic: "Topic is required" },
    };
  }

  if (def.category === "control") {
    const topicsList = topic
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (topicsList.some((t) => t.includes("+") || t.includes("#"))) {
      return {
        isValid: false,
        warning: "Cannot publish to wildcard topics (+ or #)",
        errors: { topic: "Cannot publish to wildcard topics (+ or #)" },
      };
    }
  }

  return { isValid: true };
}

export function defaultValidateWarning(
  def: PanelDefinition | undefined,
  configJson: unknown,
): string | null {
  return defaultValidateConfig(def, configJson).warning ?? null;
}

export function defaultCheckEmpty(
  def: PanelDefinition | undefined,
  configJson: unknown,
): EmptyStateInfo | null {
  if (!def) return null;

  if (def.isEmpty) {
    const res = def.isEmpty(configJson as Record<string, unknown>);
    if (!res) return null;
    if (typeof res === "string") {
      return { message: res };
    }
    if (typeof res === "object") {
      return res;
    }
    return { message: "Panel is not configured" };
  }

  if (!def.isVisual) {
    const cfg = (configJson ?? {}) as Record<string, unknown>;
    const topic = String(cfg.topic ?? cfg.topics ?? "").trim();
    if (!topic) {
      return {
        message: "No topic configured — open settings to add topic",
        actionLabel: "Configure Topic",
      };
    }
  }

  return null;
}

export function defaultBuildHeaderMeta(
  def: PanelDefinition | undefined,
  config: Record<string, unknown>,
): PanelHeaderMeta {
  if (def?.getHeaderMeta) {
    const custom = def.getHeaderMeta(config);
    return {
      topicSummary: custom.topicSummary ?? "not configured",
      topicDetail: custom.topicDetail,
      payloadPreview: custom.payloadPreview,
    };
  }

  const rawTopics =
    typeof config.topics === "string"
      ? config.topics
      : typeof config.topic === "string"
        ? config.topic
        : "";

  const topics = rawTopics
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);

  let payload: string | undefined;
  if (typeof config.payload === "string" && config.payload.trim().length > 0) {
    payload = config.payload.trim();
  }

  let topicSummary = "not configured";
  let topicDetail: string | undefined;

  if (topics.length > 1) {
    topicSummary = `${topics.length} configured`;
    topicDetail = topics.join(", ");
  } else if (topics.length === 1) {
    topicSummary = topics[0] === "#" ? "all topics" : topics[0];
  }

  return {
    topicSummary,
    topicDetail,
    payloadPreview: def?.category === "control" ? payload : undefined,
  };
}
