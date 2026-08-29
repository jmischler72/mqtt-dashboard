import { describe, it, expect } from "vitest";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  deriveReadPath,
  extractValue,
  matchTemplate,
  payloadIssue,
  placeToken,
  readValue,
} from "./payloadShape";
import { parseSliderValue } from "./sliderUtils";

describe("payloadIssue", () => {
  it("accepts the bare token, which is the default payload", () => {
    expect(payloadIssue({ template: VALUE_TOKEN })).toBeNull();
  });

  it("accepts a token wrapped in JSON", () => {
    expect(
      payloadIssue({ template: `{"brightness":${VALUE_TOKEN}}` }),
    ).toBeNull();
  });

  it("flags a payload the panel's value never reaches", () => {
    expect(payloadIssue({ template: '{"on":true}' })).toContain(TOKEN_LABEL);
  });

  it("flags an empty payload on a panel that has a value", () => {
    expect(payloadIssue({ template: "" })).toBe("No payload configured");
  });

  it("does not judge the bytes — quoted or not, JSON or not", () => {
    expect(payloadIssue({ template: `{"state":${VALUE_TOKEN}}` })).toBeNull();
    expect(payloadIssue({ template: `{"state":"${VALUE_TOKEN}"}` })).toBeNull();
    expect(payloadIssue({ template: `<set>${VALUE_TOKEN}</set>` })).toBeNull();
  });

  it("leaves a fixed payload alone, empty included", () => {
    expect(payloadIssue({ template: "", acceptsToken: false })).toBeNull();
    expect(payloadIssue({ template: "RESET", acceptsToken: false })).toBeNull();
  });

  it("flags a token on a panel with no value to put there", () => {
    expect(
      payloadIssue({ template: VALUE_TOKEN, acceptsToken: false }),
    ).toContain(TOKEN_LABEL);
  });

  it("requires the read shape to mark where the value sits", () => {
    expect(payloadIssue({ template: '{"v":1}', mode: "read" })).toContain(
      TOKEN_LABEL,
    );
    expect(payloadIssue({ template: VALUE_TOKEN, mode: "read" })).toBeNull();
  });
});

describe("JSON-ish payloads", () => {
  // Firmware that publishes `{temp:22}` is common enough that a panel able to
  // send that shape has to be able to read it back.
  it("finds the token's path in a template with unquoted keys", () => {
    expect(deriveReadPath(`{test:"${VALUE_TOKEN}"}`)).toBe("test");
    expect(deriveReadPath(`{"test":"${VALUE_TOKEN}"}`)).toBe("test");
  });

  it("reads a value out of a payload with unquoted keys", () => {
    expect(extractValue('{test:"50"}', "test").value).toBe(50);
    expect(extractValue("{temp:22,unit:'C'}", "temp").value).toBe(22);
  });

  it("tolerates single quotes and a trailing comma", () => {
    expect(extractValue("{'state':'ON',}", "state").value).toBe(true);
  });

  it("leaves strict JSON and plain text alone", () => {
    expect(extractValue('{"a":{"b":7}}', "a.b").value).toBe(7);
    expect(extractValue("plain text", "a").value).toBe("plain text");
    expect(extractValue('{"note":"it\'s fine"}', "note").value).toBe(
      "it's fine",
    );
  });

  it("drives the slider round trip end to end", () => {
    const template = `{test:"${VALUE_TOKEN}"}`;
    expect(parseSliderValue('{test:"50"}', { template })).toBe(50);
    expect(parseSliderValue('{test:"nope"}', { template })).toBeNull();
  });
});

describe("reading by stencil", () => {
  // The template already describes the shape, so the message can be read
  // straight through it without knowing what format it is in.
  it("reads formats no parser here understands", () => {
    expect(readValue(`<set>${VALUE_TOKEN}</set>`, "<set>21</set>").value).toBe(
      21,
    );
    expect(readValue(`temp=${VALUE_TOKEN}`, "temp=21.5").value).toBe(21.5);
    expect(readValue(`${VALUE_TOKEN};ON`, "40;ON").value).toBe(40);
    expect(readValue(`{test:"${VALUE_TOKEN}"}`, '{test:"50"}').value).toBe(50);
  });

  it("ignores surrounding whitespace on either side", () => {
    expect(readValue(`temp=${VALUE_TOKEN}`, "  temp=21\n").value).toBe(21);
  });

  it("falls back to the path when the message is not that shape", () => {
    // The device reports more than the panel publishes, so the stencil misses
    // and the value is located inside the parsed document instead.
    expect(
      readValue(`{"brightness":${VALUE_TOKEN}}`, '{"brightness":50,"on":true}')
        .value,
    ).toBe(50);
  });

  it("does not stencil a bare token, which anchors on nothing", () => {
    expect(matchTemplate(VALUE_TOKEN, "anything")).toBeNull();
    // It still reads as the whole message, via the path branch
    expect(readValue(VALUE_TOKEN, "42").value).toBe(42);
  });

  it("honours a legacy path when the template has no mark", () => {
    expect(readValue('{"v":1}', '{"state":7}', "state").value).toBe(7);
  });
});

describe("placing the token", () => {
  const T = VALUE_TOKEN;

  it("drops it at a caret, anywhere at all", () => {
    // Mid-word, which no value-detecting scheme would have offered
    expect(placeToken("bright", 3, 3).template).toBe(`bri${T}ght`);
    expect(placeToken('{"b":12}', 5, 5).template).toBe(`{"b":${T}12}`);
  });

  it("replaces a selection", () => {
    expect(placeToken('{"b":12}', 5, 7).template).toBe(`{"b":${T}}`);
    expect(placeToken("SET 20 C", 4, 6).template).toBe(`SET ${T} C`);
  });

  it("leaves the caret just past the token", () => {
    const placed = placeToken('{"b":12}', 5, 7);
    expect(placed.template.slice(0, placed.caret)).toBe(`{"b":${T}`);
  });

  it("moves an existing token rather than adding a second", () => {
    const placed = placeToken(`{"a":${T},"b":9}`, 11, 12, "1");
    expect(placed.template).toBe(`{"a":1,"b":${T}}`);
    expect(placed.template.split(T)).toHaveLength(2);
  });

  it("stays put when dropped where it already is", () => {
    // Repeated taps of the button: the caret sits just past the chip each time
    let template = `{"b":${T}}`;
    for (let i = 0; i < 3; i++) {
      const placed = placeToken(template, 6, 6);
      expect(placed.template).toBe(`{"b":${T}}`);
      template = placed.template;
    }
  });

  it("accounts for the restored constant when placing the caret", () => {
    const placed = placeToken(`${T} C`, 3, 3, "20");
    expect(placed.template).toBe(`20 C${T}`);
    expect(placed.caret).toBe(placed.template.length);
  });
});
