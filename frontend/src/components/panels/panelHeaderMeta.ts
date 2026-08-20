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
  const rawTopics =
    typeof config.topics === "string"
      ? config.topics
      : typeof config.topic === "string"
        ? config.topic
        : "";
  const topics = parseTopics(rawTopics);
  const payload = configuredTopic(config.payload);

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
    payloadPreview:
      panelType === "button" || panelType === "cron"
        ? payload || undefined
        : undefined,
  };
}
