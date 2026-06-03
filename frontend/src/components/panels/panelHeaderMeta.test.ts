import { describe, expect, it } from "vitest";
import { buildPanelHeaderMeta } from "./panelHeaderMeta";

describe("buildPanelHeaderMeta", () => {
  it("formats single-topic panels with explicit topic", () => {
    const meta = buildPanelHeaderMeta("input", { topic: "sensors/temp" });
    expect(meta.topicSummary).toBe("topic: sensors/temp");
    expect(meta.topicDetail).toBeUndefined();
  });

  it("summarizes comma-separated log topics", () => {
    const meta = buildPanelHeaderMeta("log", {
      topics: "sensors/temp, sensors/humidity, home/light",
    });
    expect(meta.topicSummary).toBe("topics: 3 configured");
    expect(meta.topicDetail).toBe("sensors/temp, sensors/humidity, home/light");
  });

  it("keeps single log topic explicit", () => {
    const meta = buildPanelHeaderMeta("log", { topics: "alerts/system" });
    expect(meta.topicSummary).toBe("topic: alerts/system");
    expect(meta.topicDetail).toBeUndefined();
  });

  it("exposes payload preview only for button panels", () => {
    const buttonMeta = buildPanelHeaderMeta("button", {
      topic: "devices/1/cmd",
      payload: '{"action":"on"}',
    });
    const inputMeta = buildPanelHeaderMeta("input", {
      topic: "devices/1/cmd",
      payload: '{"action":"on"}',
    });

    expect(buttonMeta.payloadPreview).toBe('{"action":"on"}');
    expect(inputMeta.payloadPreview).toBeUndefined();
  });
});
