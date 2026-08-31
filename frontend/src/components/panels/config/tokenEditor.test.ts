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

describe("readSelectionOffsets", () => {
  /** The [text, <br>, text] shape browsers that use <br> for Enter produce. */
  function twoLines(): HTMLElement {
    const host = document.createElement("div");
    host.contentEditable = "true";
    host.append(
      document.createTextNode("a"),
      document.createElement("br"),
      document.createTextNode("b"),
    );
    document.body.append(host);
    return host;
  }

  function caretAt(container: Node, offset: number) {
    const range = document.createRange();
    range.setStart(container, offset);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  it("counts a line break the user typed", () => {
    const host = twoLines();
    expect(readTemplate(host)).toBe("a\nb");

    // Start of the second line. Measuring a clone of the content up to here
    // made the <br> look like the browser's trailing filler and dropped it,
    // leaving every offset past a line break one short.
    caretAt(host.childNodes[2], 0);
    expect(readSelectionOffsets(host)).toEqual({ start: 2, end: 2 });
  });

  it("still ignores the filler break at the end of the box", () => {
    const host = document.createElement("div");
    host.contentEditable = "true";
    host.append(document.createTextNode("a"), document.createElement("br"));
    document.body.append(host);

    expect(readTemplate(host)).toBe("a");
    caretAt(host, host.childNodes.length);
    expect(readSelectionOffsets(host)).toEqual({ start: 1, end: 1 });
  });

  it("reports a selection, not just a caret", () => {
    const host = twoLines();
    const range = document.createRange();
    range.setStart(host.childNodes[0], 0);
    range.setEnd(host.childNodes[2], 1);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(readSelectionOffsets(host)).toEqual({ start: 0, end: 3 });
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
