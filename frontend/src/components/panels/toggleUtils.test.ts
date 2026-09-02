import { describe, it, expect } from "vitest";
import {
  extractPayloadValue,
  parseToggleState,
  toggleWritePayload,
  toggleWritePayloads,
} from "./toggleUtils";
import { VALUE_TOKEN } from "./payloadShape";

const STATE_SHAPE = { readTemplate: `{"state":"${VALUE_TOKEN}"}` };

describe("extractPayloadValue", () => {
  it("returns the trimmed payload when no shape marks a part of it", () => {
    expect(extractPayloadValue("  ON  ")).toBe("ON");
  });

  it("unwraps the part the shape marks", () => {
    expect(extractPayloadValue('{"state":"ON","rssi":-40}', STATE_SHAPE)).toBe(
      "ON",
    );
  });

  it("stringifies values the shape marks that are not text", () => {
    const bare = { readTemplate: `{"state":${VALUE_TOKEN}}` };
    expect(extractPayloadValue('{"state":true}', bare)).toBe("true");
    expect(extractPayloadValue('{"state":1}', bare)).toBe("1");
  });

  it("falls back to the raw payload when the field is missing", () => {
    expect(extractPayloadValue('{"other":"ON"}', STATE_SHAPE)).toBe(
      '{"other":"ON"}',
    );
  });

  it("falls back to the raw payload when the payload is not JSON", () => {
    expect(extractPayloadValue("ON", STATE_SHAPE)).toBe("ON");
  });

  it("reads a null the device sent as the characters it sent", () => {
    // The stencil reports the bytes at the mark; it does not parse them. What
    // matters is that they match neither state, so the panel says "unknown"
    // rather than picking one.
    const shape = { readTemplate: `{"state":${VALUE_TOKEN}}` };
    expect(extractPayloadValue('{"state":null}', shape)).toBe("null");
    expect(
      parseToggleState('{"state":null}', {
        ...shape,
        onPayload: "ON",
        offPayload: "OFF",
      }),
    ).toBeNull();
  });

  it("reads by the path the shape implies when the stencil does not line up", () => {
    // Same message, different key order: the modal's preview has always read
    // this, and the panel now reads it the same way.
    expect(
      extractPayloadValue('{"rssi":-60,"state":"ON"}', {
        readTemplate: '{"state":"{value}"}',
      }),
    ).toBe("ON");
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

  it("reads through the field the shape marks", () => {
    const opts = { ...STATE_SHAPE, onPayload: "ON", offPayload: "OFF" };
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

describe("parseToggleState with a read shape of its own", () => {
  const shape = {
    payloadTemplate: '{"cmd":"{value}"}',
    readTemplate: '{"state":"{value}"}',
    onPayload: "open",
    offPayload: "close",
  };

  it("compares the read value against the configured states", () => {
    expect(parseToggleState('{"state":"open"}', shape)).toBe(true);
    expect(parseToggleState('{"state":"close"}', shape)).toBe(false);
  });

  it("still recognises the bytes it published, for a device that echoes them", () => {
    expect(
      parseToggleState('{"cmd":"open"}', { ...shape, readTemplate: "" }),
    ).toBe(true);
  });

  it("reads a legacy config that stored whole messages as its states", () => {
    expect(
      parseToggleState('{"state":"ON","rssi":-40}', {
        readTemplate: '{"state":"{value}"}',
        onPayload: '{"state":"ON"}',
        offPayload: '{"state":"OFF"}',
      }),
    ).toBe(true);
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

  it("publishes the values on their own when the template lost its chip", () => {
    // The modal blocks saving this, but a seeded config can still hold it — and
    // the config modal previews the states through the same function, so what
    // it shows and what the panel sends can never drift apart.
    expect(
      toggleWritePayloads({
        payloadTemplate: '{"state":""}',
        onPayload: "ON",
        offPayload: "OFF",
      }),
    ).toEqual({ on: "ON", off: "OFF" });
  });
});

describe("toggleWritePayload", () => {
  it("is the bytes one state publishes", () => {
    expect(toggleWritePayload("ON", '{"state":"{value}"}')).toBe(
      '{"state":"ON"}',
    );
  });

  it("sends the value alone with no template, or one with no chip", () => {
    expect(toggleWritePayload("ON")).toBe("ON");
    expect(toggleWritePayload("ON", '{"state":""}')).toBe("ON");
  });
});
