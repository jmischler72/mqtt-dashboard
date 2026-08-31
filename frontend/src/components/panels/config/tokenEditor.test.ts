import { beforeEach, describe, expect, it } from "vitest";
import { VALUE_TOKEN, placeToken } from "../payloadShape";
import {
  paintTemplate,
  readSelectionOffsets,
  readTemplate,
  setCaret,
} from "./tokenEditor";

/** A painted box, the way the payload editor holds one. */
function box(template: string): HTMLElement {
  const host = document.createElement("div");
  host.contentEditable = "true";
  document.body.append(host);
  paintTemplate(host, template);
  return host;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("paintTemplate / readTemplate", () => {
  it("round-trips a template through the DOM", () => {
    const template = '{"v":{value},"u":"C"}';
    expect(readTemplate(box(template))).toBe(template);
  });

  it("draws the token as a single atomic chip", () => {
    const chips = box("a{value}b").querySelectorAll("[data-value-token]");
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute("contenteditable")).toBe("false");
  });
});

describe("setCaret", () => {
  // The offsets `readTemplate`, `readSelectionOffsets` and `placeToken` all
  // count in are payload offsets, where the chip is as wide as the token it
  // stands for. Counting it as one character instead landed the caret six
  // characters off whenever anything followed the chip.
  it.each([0, 3, 5, 5 + VALUE_TOKEN.length, 14])(
    "puts the caret at payload offset %i",
    (offset) => {
      const host = box('{"v":{value},"u":"C"}');
      setCaret(host, offset);
      expect(readSelectionOffsets(host)).toEqual({
        start: offset,
        end: offset,
      });
    },
  );

  it("lands just past the chip the controls placed", () => {
    const template = '{"v":23.5,"u":"C"}';
    const placed = placeToken(template, 5, 9);
    const host = box(placed.template);

    setCaret(host, placed.caret);

    expect(placed.template).toBe('{"v":{value},"u":"C"}');
    expect(readSelectionOffsets(host)).toEqual({
      start: placed.caret,
      end: placed.caret,
    });
    // Nothing of the token sits to the right of the caret
    expect(placed.template.slice(placed.caret)).toBe(',"u":"C"}');
  });
});
