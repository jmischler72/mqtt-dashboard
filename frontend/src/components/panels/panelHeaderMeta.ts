export interface PanelHeaderMeta {
  topicSummary: string;
  topicDetail?: string;
  payloadPreview?: string;
}

function parseTopics(topics: string): string[] {
  return topics
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

function configuredTopic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildPanelHeaderMeta(
  panelType: string,
  config: Record<string, unknown>,
): PanelHeaderMeta {
  if (panelType === "log") {
    const rawTopics = typeof config.topics === "string" ? config.topics : "";
    const topics = parseTopics(rawTopics);
    if (topics.length === 0) {
      return { topicSummary: "not configured" };
    }
    if (rawTopics.includes(",") && topics.length > 1) {
      return {
        topicSummary: `${topics.length} configured`,
        topicDetail: topics.join(", "),
      };
    }
    return { topicSummary: `${topics[0]}` };
  }

  if (panelType === "stats") {
    const topic = configuredTopic(config.topic);
    return { topicSummary: topic ?? "# all topics" };
  }

  const topic = configuredTopic(config.topic);
  const payload = configuredTopic(config.payload);

  return {
    topicSummary: topic ? `${topic}` : "not configured",
    payloadPreview:
      panelType === "button" || panelType === "cron"
        ? payload || undefined
        : undefined,
  };
}
