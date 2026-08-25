/**
 * Checks whether an MQTT topic matches a given search/filter query.
 *
 * Matching rules:
 * - Empty query matches everything.
 * - Simple case-insensitive substring match on full topic path.
 * - If query includes MQTT wildcards ('+' for single level, '#' for multi-level) or glob ('*'),
 *   matches topic structure accordingly.
 */
export function topicMatchesFilter(topic: string, filter: string): boolean {
  const q = filter.trim();
  if (!q) return true;

  const lowerTopic = topic.toLowerCase();
  const lowerFilter = q.toLowerCase();

  // Simple substring match first
  if (lowerTopic.includes(lowerFilter)) {
    return true;
  }

  // If query contains wildcards (+ or # or *)
  if (q.includes("+") || q.includes("#") || q.includes("*")) {
    try {
      const escaped = lowerFilter
        .replace(/[.+^${}()|[\]\\]/g, (char) => {
          if (char === "+" || char === "^" || char === "$") {
            return char === "+" ? "+" : `\\${char}`;
          }
          return `\\${char}`;
        })
        .replace(/\+/g, "[^/]+")
        .replace(/#/g, ".*")
        .replace(/\*/g, ".*");

      const regex = new RegExp(`^${escaped}$`, "i");
      if (regex.test(lowerTopic)) {
        return true;
      }
    } catch {
      // Fallback if regex creation fails
    }
  }

  return false;
}
