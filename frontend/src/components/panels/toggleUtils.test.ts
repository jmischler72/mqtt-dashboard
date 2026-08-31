import { describe, it, expect } from "vitest";
import {
  extractPayloadValue,
  parseToggleState,
  toggleWritePayloads,
} from "./toggleUtils";

describe("extractPayloadValue", () => {
  it("returns the trimmed payload when no valueKey is set", () => {
    expect(extractPayloadValue("  ON  ")).toBe("ON");
  });

  it("unwraps the configured key from a JSON object", () => {
    expect(
      extractPayloadValue('{"state":"ON","rssi":-40}', { valueKey: "state" }),
    ).toBe("ON");
  });

  it("stringifies non-string JSON values", () => {
    expect(extractPayloadValue('{"state":true}', { valueKey: "state" })).toBe(
      "true",
    );
    expect(extractPayloadValue('{"state":1}', { valueKey: "state" })).toBe("1");
  });

  it("falls back to the raw payload when the key is missing", () => {
    expect(extractPayloadValue('{"other":"ON"}', { valueKey: "state" })).toBe(
      '{"other":"ON"}',
    );
  });

  it("falls back to the raw payload when the payload is not JSON", () => {
    expect(extractPayloadValue("ON", { valueKey: "state" })).toBe("ON");
  });

  it("returns an empty string for null values", () => {
    expect(extractPayloadValue('{"state":null}', { valueKey: "state" })).toBe(
      "",
    );
  });
});

describe("parseToggleState", () => {
  it("matches the configured payloads", () => {
    const opts = { onPayload: "1", offPayload: "0" };
    expect(parseToggleState("1", opts)).toBe(true);
    expect(parseToggleState("0", opts)).toBe(false);
  });

  it("matches configured payloads case-insensitively and ignores surrounding space", () => {
    const opts = { onPayload: "On", offPayload: "Off" };
    expect(parseToggleState(" on ", opts)).toBe(true);
    expect(parseToggleState("OFF", opts)).toBe(false);
  });

  it("defaults to ON/OFF when no payloads are configured", () => {
    expect(parseToggleState("ON")).toBe(true);
    expect(parseToggleState("OFF")).toBe(false);
  });

  it("falls back to the shared truthiness table", () => {
    expect(parseToggleState("true")).toBe(true);
    expect(parseToggleState("online")).toBe(true);
    expect(parseToggleState("no")).toBe(false);
    expect(parseToggleState("offline")).toBe(false);
  });

  it("treats non-zero numbers as on", () => {
    expect(parseToggleState("1")).toBe(true);
    expect(parseToggleState("255")).toBe(true);
    expect(parseToggleState("0")).toBe(false);
  });

  it("reads through a JSON valueKey", () => {
    const opts = { valueKey: "state", onPayload: "ON", offPayload: "OFF" };
    expect(parseToggleState('{"state":"ON"}', opts)).toBe(true);
    expect(parseToggleState('{"state":"OFF"}', opts)).toBe(false);
    expect(parseToggleState('{"state":true}', opts)).toBe(true);
  });

  it("prefers the configured payloads over the truthiness table", () => {
    // "off" would normally be falsy, but it is configured as the ON payload here
    expect(
      parseToggleState("off", { onPayload: "off", offPayload: "on" }),
    ).toBe(true);
  });

  it("returns null for payloads it cannot map", () => {
    expect(parseToggleState("something else")).toBeNull();
    expect(parseToggleState("")).toBeNull();
    expect(parseToggleState("   ")).toBeNull();
  });

  it("ignores blank configured payloads instead of matching everything", () => {
    expect(parseToggleState("ON", { onPayload: "", offPayload: "" })).toBe(
      true,
    );
    expect(
      parseToggleState("whatever", { onPayload: "", offPayload: "" }),
    ).toBeNull();
  });
});

describe("toggleWritePayloads", () => {
  it("drops each value into the shared template", () => {
    expect(
      toggleWritePayloads({
        payloadTemplate: '{"state":"{value}"}',
        onPayload: "ON",
        offPayload: "OFF",
      }),
    ).toEqual({ on: '{"state":"ON"}', off: '{"state":"OFF"}' });
  });

  it("publishes the value on its own for a bare chip", () => {
    expect(
      toggleWritePayloads({
        payloadTemplate: "{value}",
        onPayload: "1",
        offPayload: "0",
      }),
    ).toEqual({ on: "1", off: "0" });
  });

  it("leaves a config with no template publishing its values verbatim", () => {
    // What a toggle saved with its two states written out in full amounts to
    expect(
      toggleWritePayloads({
        onPayload: '{"state":"ON"}',
        offPayload: '{"state":"OFF"}',
      }),
    ).toEqual({ on: '{"state":"ON"}', off: '{"state":"OFF"}' });
  });

  it("defaults to ON and OFF", () => {
    expect(toggleWritePayloads({})).toEqual({ on: "ON", off: "OFF" });
  });
});
