import { describe, it, expect } from "vitest";
import { topicRules, useConfigValidation } from "./useConfigValidation";

/**
 * The rules are pure and so is the hook — it holds no state, it just picks
 * which of them speak — so it is called directly rather than through a render.
 */
const useBroken = (rules: ReturnType<typeof topicRules>) =>
  useConfigValidation(rules);

describe("topicRules", () => {
  it("asks for a topic before anything else", () => {
    expect(useBroken(topicRules({ topic: "  " })).blockerReason).toContain(
      "is needed",
    );
  });

  it("refuses a wildcard on a topic that is published to", () => {
    expect(
      useBroken(topicRules({ topic: "home/+/set" })).fieldErrors.topic,
    ).toContain("wildcard");
    expect(
      useBroken(topicRules({ topic: "home/+/state", allowWildcards: true }))
        .blockerReason,
    ).toBeNull();
  });

  it("says so when a panel that reads one topic is given several", () => {
    // The panel takes the first and drops the rest, which used to happen in
    // silence — the topic was truncated on save with nothing said
    const { blockerReason } = useBroken(
      topicRules({ topic: "home/a/set, home/b/set", allowMultiple: false }),
    );
    expect(blockerReason).toContain("one topic");
    expect(blockerReason).toContain("home/a/set");
  });

  it("leaves a list alone where the panel really does watch several", () => {
    expect(
      useBroken(topicRules({ topic: "home/a, home/b", allowWildcards: true }))
        .blockerReason,
    ).toBeNull();
  });
});
