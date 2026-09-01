import { describe, it, expect } from "vitest";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  describeTemplate,
  deriveReadPath,
  effectiveReadPath,
  effectiveReadTemplate,
  extractValue,
  findLiterals,
  keepOneToken,
  matchTemplate,
  offsetAfterKeepOneToken,
  payloadIssue,
  placeToken,
  readShape,
  resolvePath,
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
    expect(payloadIssue({ template: "" })).toBe(
      "No message configured — this panel has nothing to publish.",
    );
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

  it("publishes the token's own text on a panel with no value to put there", () => {
    // These panels send the box verbatim, so the characters are the payload.
    expect(
      payloadIssue({ template: VALUE_TOKEN, acceptsToken: false }),
    ).toBeNull();
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

  it("treats the template's tail as optional, so extra fields still read", () => {
    // The user described the field they care about, not the whole document
    expect(
      readValue(`{"temp":${VALUE_TOKEN}}`, '{"temp":21.4,"battery":{"pct":92}}')
        .value,
    ).toBe(21.4);
    expect(
      readValue(`random: ${VALUE_TOKEN} (ok)`, "random: 21.4 (ok)").value,
    ).toBe(21.4);
  });

  it("reads a quoted value without dragging its closing quote along", () => {
    expect(
      readValue(
        `{"room":"${VALUE_TOKEN}"}`,
        '{"value":37,"room":"bathroom","src":"esp32"}',
      ).value,
    ).toBe("bathroom");
  });

  it("does not swallow a nested object when the tail lines up late", () => {
    // The tail `}` matches the *outer* brace, so an unguarded stencil hands
    // back the truncated fragment `{"temp":21.5` and calls it the value.
    expect(
      matchTemplate(`{"data":${VALUE_TOKEN}}`, '{"data":{"temp":21.5}}'),
    ).toBeNull();
    // …and the shape is reported as not fitting rather than as a match
    expect(
      readShape(`{"data":${VALUE_TOKEN}}`, '{"data":{"temp":21.5}}').found,
    ).toBe(false);
  });

  it("still reads a value that merely contains colons", () => {
    expect(
      readValue(`{"time":"${VALUE_TOKEN}"}`, '{"time":"12:30:00"}').value,
    ).toBe("12:30:00");
  });

  it("pins a token that leads the shape to the start of the message", () => {
    // `{value} °C` has no head to anchor on. Free-floating it seizes the first
    // string in any payload, so an unrelated message reads as a fit.
    expect(
      matchTemplate(`${VALUE_TOKEN} °C`, '{"error":"offline"}'),
    ).toBeNull();
    expect(readShape(`${VALUE_TOKEN} °C`, '{"error":"offline"}').found).toBe(
      false,
    );
    // A message that really is the value still reads, unit or not
    expect(matchTemplate(`${VALUE_TOKEN} °C`, "21.4 °C")).toBe("21.4");
    expect(matchTemplate(`${VALUE_TOKEN} °C`, "21.4")).toBe("21.4");
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
    const template = `{"a":${T},"b":9}`;
    const nine = template.indexOf("9");
    const placed = placeToken(template, nine, nine + 1, "1");
    expect(placed.template).toBe(`{"a":1,"b":${T}}`);
    expect(placed.template.split(T)).toHaveLength(2);
  });

  it("stays put when dropped where it already is", () => {
    // Repeated taps of the button: the caret sits just past the chip each time
    let template = `{"b":${T}}`;
    for (let i = 0; i < 3; i++) {
      // The caret sits just past the chip after each tap
      const placed = placeToken(template, 5 + T.length, 5 + T.length);
      expect(placed.template).toBe(`{"b":${T}}`);
      template = placed.template;
    }
  });

  it("accounts for the restored constant when placing the caret", () => {
    const placed = placeToken(`${T} C`, T.length + 2, T.length + 2, "20");
    expect(placed.template).toBe(`20 C${T}`);
    expect(placed.caret).toBe(placed.template.length);
  });
});

describe("describeTemplate", () => {
  it("says the payload the way the editor draws it", () => {
    expect(describeTemplate(`{"brightness":${VALUE_TOKEN}}`)).toBe(
      `{"brightness":${TOKEN_LABEL}}`,
    );
    expect(describeTemplate(VALUE_TOKEN)).toBe(TOKEN_LABEL);
    expect(describeTemplate("RESET")).toBe("RESET");
  });
});

describe("readShape", () => {
  it("reads the whole payload through a bare chip, and calls it a fit", () => {
    // The gauge opens on this shape, so it must never read as "does not match"
    expect(readShape(VALUE_TOKEN, "21.4")).toMatchObject({
      value: 21.4,
      found: true,
    });
    expect(readShape(VALUE_TOKEN, '{"t":21.4}')).toMatchObject({
      value: '{"t":21.4}',
      found: true,
    });
  });

  it("still reports a shape that does not fit the message", () => {
    expect(readShape(`{"t":${VALUE_TOKEN}}`, '{"h":60}').found).toBe(false);
  });

  it("reads a bare chip through the stored path the panel still uses", () => {
    // A gauge saved with an array index opens on the bare chip, because no
    // object literal can draw `items.0.temp`. The panel goes on reading that
    // path, so the preview has to as well or the two describe different panels.
    expect(
      readShape(VALUE_TOKEN, '{"items":[{"temp":21.5}]}', "items.0.temp"),
    ).toMatchObject({ value: 21.5, found: true });
  });

  it("falls back to the stored path when the shape marks nothing", () => {
    expect(readShape("", '{"t":21.4}', "t")).toMatchObject({
      value: 21.4,
      found: true,
    });
  });

  it("ignores a stored path that names nothing in this message", () => {
    // Still the whole payload, still a fit: a blank shape says exactly that.
    expect(readShape(VALUE_TOKEN, '{"h":60}', "t")).toMatchObject({
      value: '{"h":60}',
      found: true,
    });
  });
});

describe("offsetAfterKeepOneToken", () => {
  it("moves the caret back past a duplicate that was before it", () => {
    const template = `{"a":${VALUE_TOKEN},"b":${VALUE_TOKEN}}`;
    // Caret just past the second spelling, which is the one that gets dropped
    const at = template.lastIndexOf(VALUE_TOKEN) + VALUE_TOKEN.length;
    expect(offsetAfterKeepOneToken(template, at)).toBe(at - VALUE_TOKEN.length);
  });

  it("leaves the caret alone when the dropped mark is after it", () => {
    // The first mark survives, so a chip typed ahead of an existing one keeps
    // its place and the older one behind the caret is what goes.
    const template = `{"a":${VALUE_TOKEN},"b":${VALUE_TOKEN}}`;
    const at = template.indexOf(VALUE_TOKEN) + VALUE_TOKEN.length;
    expect(offsetAfterKeepOneToken(template, at)).toBe(at);
  });

  it("collapses a caret inside a dropped mark onto where it began", () => {
    const template = `${VALUE_TOKEN}x${VALUE_TOKEN}`;
    const second = template.lastIndexOf(VALUE_TOKEN);
    expect(offsetAfterKeepOneToken(template, second + 3)).toBe(second);
  });

  it("leaves a template with one mark, or none, untouched", () => {
    expect(offsetAfterKeepOneToken(`{"a":${VALUE_TOKEN}}`, 9)).toBe(9);
    expect(offsetAfterKeepOneToken("RESET", 3)).toBe(3);
  });
});

describe("keepOneToken", () => {
  it("keeps the mark the user made and drops a second spelling of it", () => {
    expect(keepOneToken(`{"a":${VALUE_TOKEN},"b":${VALUE_TOKEN}}`)).toBe(
      `{"a":${VALUE_TOKEN},"b":}`,
    );
  });

  it("leaves a template with one mark, or none, exactly as it is", () => {
    expect(keepOneToken(`{"a":${VALUE_TOKEN}}`)).toBe(`{"a":${VALUE_TOKEN}}`);
    expect(keepOneToken("RESET")).toBe("RESET");
  });
});

describe("findLiterals", () => {
  it("offers the values, never the keys naming them", () => {
    expect(findLiterals('{"temp":21.4}').map((l) => l.text)).toEqual(["21.4"]);
    // Keys are not always quoted — `parseLooseJson` reads this too, and the
    // `1` of `ch1` is half a field name, not a reading
    expect(findLiterals("{ch1:5}").map((l) => l.text)).toEqual(["5"]);
  });

  it("offers a value that is a bare word rather than the whole document", () => {
    expect(findLiterals('{"cmd":true}').map((l) => l.text)).toEqual(["true"]);
  });

  it("offers a lone payload, which is its own value", () => {
    expect(findLiterals("RESET").map((l) => l.text)).toEqual(["RESET"]);
  });

  it("still offers a value that merely sits next to punctuation", () => {
    expect(findLiterals("random: 21.4 (ok)").map((l) => l.text)).toEqual([
      "21.4",
    ]);
  });
});

describe("effectiveReadTemplate", () => {
  it("mirrors the write shape when no read shape was ever set", () => {
    expect(
      effectiveReadTemplate({ payloadTemplate: `{"state":"${VALUE_TOKEN}"}` }),
    ).toBe(`{"state":"${VALUE_TOKEN}"}`);
  });

  it("keeps a blank read shape, which means the whole payload", () => {
    // The modal offers the empty box as an answer and previews it that way; a
    // fallback here would have the panel read by different rules
    expect(
      effectiveReadTemplate({
        payloadTemplate: `{"state":"${VALUE_TOKEN}"}`,
        readTemplate: "",
        separateRead: true,
      }),
    ).toBe("");
    expect(
      effectiveReadPath({
        payloadTemplate: `{"state":"${VALUE_TOKEN}"}`,
        readTemplate: "",
        separateRead: true,
      }),
    ).toBeUndefined();
  });
});

describe("resolvePath", () => {
  it("does not resolve a key every object inherits", () => {
    // `{"toString":{value}}` would otherwise fit any message at all, and hand
    // the panel a function's source to draw
    expect(resolvePath({ a: 1 }, "toString").found).toBe(false);
    expect(resolvePath({ a: { b: 1 } }, "a.constructor").found).toBe(false);
    expect(readShape(`{"toString":${VALUE_TOKEN}}`, '{"a":1}').found).toBe(
      false,
    );
  });

  it("takes a key containing a dot as one field before splitting it", () => {
    // How a panel saved before paths existed stored its key
    expect(resolvePath({ "sensor.temp": 21 }, "sensor.temp")).toEqual({
      found: true,
      value: 21,
    });
  });

  it("still walks a real path", () => {
    expect(resolvePath({ sensor: { temp: 21 } }, "sensor.temp")).toEqual({
      found: true,
      value: 21,
    });
    expect(resolvePath({ items: [{ t: 3 }] }, "items.0.t")).toEqual({
      found: true,
      value: 3,
    });
  });
});
