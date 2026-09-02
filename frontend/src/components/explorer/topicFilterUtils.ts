/**
 * Checks whether an MQTT topic matches a given search/filter query.
 *
 * Matching rules:
 * - Empty query matches everything.
 * - Simple case-insensitive substring match on full topic path.
 * - If query includes MQTT wildcards ('+' for single level, '#' for multi-level) or glob ('*'),
 *   matches topic structure accordingly.
 */

// Translate a filter into a regex source, expanding each wildcard exactly once.
function filterToRegexSource(filter: string): string {
  let rest = filter;
  // In MQTT, `a/#` matches the parent topic `a` as well, so the trailing
  // `/#` compiles to an optional group.
  const parentMatch = rest.endsWith("/#");
  if (parentMatch) {
    rest = rest.slice(0, -2);
  }

  let source = "";
  for (const char of rest) {
    if (char === "+") {
      source += "[^/]+";
    } else if (char === "#" || char === "*") {
      source += ".*";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return parentMatch ? `${source}(?:/.*)?` : source;
}

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
      const regex = new RegExp(`^${filterToRegexSource(lowerFilter)}$`, "i");
      if (regex.test(lowerTopic)) {
        return true;
      }
    } catch {
      // Fallback if regex creation fails
    }
  }

  return false;
}
