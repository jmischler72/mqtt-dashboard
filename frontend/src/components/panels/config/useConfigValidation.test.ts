import { describe, it, expect } from "vitest";
import {
  payloadRules,
  topicRules,
  useConfigValidation,
} from "./useConfigValidation";

/**
 * The rules are pure and so is the hook — it holds no state, it just picks
 * which of them speak — so it is called directly rather than through a render.
 */
const useBroken = (rules: ReturnType<typeof topicRules>) =>
  useConfigValidation(rules);

describe("topicRules", () => {
  it("asks for a topic before anything else", () => {
    expect(useBroken(topicRules({ topic: "  " })).blockerReason).toContain(
      "is required",
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

describe("payloadRules in read mode", () => {
  it("allows exactly one value token", () => {
    const rules = payloadRules({
      value: '{"temp":{{value}}}',
      mode: "read",
    });
    expect(useConfigValidation(rules).blockerReason).toBeNull();
  });

  it("refuses multiple value tokens", () => {
    const rules = payloadRules({
      value: '{"temp":{{value}},"hum":{{value}}}',
      mode: "read",
    });
    const validation = useConfigValidation(rules);
    expect(validation.blockerReason).toContain("only mark one value");
    expect(validation.fieldErrors.payload).toContain("only mark one value");
  });

  it("refuses multiple indexed tokens in read mode", () => {
    const rules = payloadRules({
      value: '{"temp":{{value:1}},"hum":{{value:2}}}',
      mode: "read",
    });
    const validation = useConfigValidation(rules);
    expect(validation.blockerReason).toContain("only mark one value");
  });

  it("allows multiple tokens in write mode", () => {
    const rules = payloadRules({
      value: '{"temp":{{value:1}},"hum":{{value:2}}}',
      mode: "write",
    });
    expect(useConfigValidation(rules).blockerReason).toBeNull();
  });
});
