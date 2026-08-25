import type {
  PanelCategory,
  PanelDefinition,
  PanelHeaderMeta,
} from "./types";

const registry = new Map<string, PanelDefinition>();

export function registerPanel(definition: PanelDefinition): void {
  registry.set(definition.type, definition);
}

export function getPanelDefinition(
  type: string,
): PanelDefinition | undefined {
  return registry.get(type);
}

export function getAllPanels(): PanelDefinition[] {
  return Array.from(registry.values());
}

export function getPanelsByCategory(category: PanelCategory): PanelDefinition[] {
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

export function defaultValidateWarning(
  def: PanelDefinition | undefined,
  configJson: unknown,
): string | null {
  if (!def || def.isVisual) return null;

  if (def.validateWarning) {
    return def.validateWarning(configJson as Record<string, unknown>);
  }

  const cfg = (configJson ?? {}) as Record<string, unknown>;
  const topic = String(cfg.topic ?? cfg.topics ?? "").trim();

  if (!topic) {
    return "No topic configured";
  }

  if (def.category === "control") {
    const topicsList = topic.split(",").map((t) => t.trim()).filter(Boolean);
    if (topicsList.some((t) => t.includes("+") || t.includes("#"))) {
      return "Cannot publish to wildcard topics (+ or #)";
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
