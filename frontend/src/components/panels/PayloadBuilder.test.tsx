import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PayloadBuilder from "./PayloadBuilder";
import { TOKEN_LABEL, VALUE_TOKEN } from "./payloadShape";
import {
  TOKEN_ATTR,
  paintTemplate,
  readSelectionOffsets,
  readTemplate,
  setCaret,
} from "./tokenEditor";

vi.mock("../../hooks/usePayloadSample", () => ({
  usePayloadSample: () => ({
    recent: [],
    loading: false,
    payload: null,
    suggestedPaths: [],
  }),
}));

function host(html?: string): HTMLElement {
  const el = document.createElement("div");
  if (html !== undefined) el.innerHTML = html;
  return el;
}

describe("token editor DOM", () => {
  it("paints the token as an atomic chip and the rest as text", () => {
    const el = host();
    paintTemplate(el, `{"brightness":${VALUE_TOKEN}}`);

    const chips = el.querySelectorAll(`[${TOKEN_ATTR}]`);
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe(TOKEN_LABEL);
    expect(chips[0].getAttribute("contenteditable")).toBe("false");
    expect(el.textContent).toBe('{"brightness":value}');
  });

  it("reads back exactly what was painted", () => {
    const templates = [
      `{"brightness":${VALUE_TOKEN}}`,
      VALUE_TOKEN,
      "RESET",
      "",
      `${VALUE_TOKEN};ON`,
    ];

    for (const template of templates) {
      const el = host();
      paintTemplate(el, template);
      expect(readTemplate(el)).toBe(template);
    }
  });

  it("reads newlines back out of both shapes a browser produces", () => {
    expect(readTemplate(host("a<br>b"))).toBe("a\nb");
    expect(readTemplate(host("<div>a</div><div>b</div>"))).toBe("a\nb");
  });

  it("ignores the filler <br> a browser parks at the end", () => {
    // Invisible to the user, so publishing the newline it stands for would
    // append a byte they never typed
    expect(readTemplate(host("a<br>"))).toBe("a");
    expect(readTemplate(host("<div>a</div><div>b<br></div>"))).toBe("a\nb");
    // A blank line the user actually made is still a line
    expect(readTemplate(host("a<br><br>"))).toBe("a\n");
  });

  it("repainting replaces the previous content rather than appending", () => {
    const el = host();
    paintTemplate(el, `{"a":${VALUE_TOKEN}}`);
    paintTemplate(el, "RESET");
    expect(readTemplate(el)).toBe("RESET");
    expect(el.querySelectorAll(`[${TOKEN_ATTR}]`)).toHaveLength(0);
  });
});

describe("PayloadBuilder editor", () => {
  afterEach(cleanup);

  function openEditor(template: string, onTemplateChange = () => {}) {
    render(
      <PayloadBuilder
        template={template}
        onTemplateChange={onTemplateChange}
        previews={[{ key: "", value: "50" }]}
        brokerId="b1"
        topic="home/lamp"
      />,
    );
    fireEvent.click(screen.getByText(/Edit/));
    return screen.getByRole("textbox");
  }

  it("shows the payload with the token as a chip", () => {
    const box = openEditor(`{"brightness":${VALUE_TOKEN}}`);
    expect(box.textContent).toBe('{"brightness":value}');
    expect(box.querySelectorAll(`[${TOKEN_ATTR}]`)).toHaveLength(1);
  });

  it("reports edits back as a payload string", () => {
    const onTemplateChange = vi.fn();
    const box = openEditor(VALUE_TOKEN, onTemplateChange);

    // What the browser leaves behind after typing "C" ahead of the chip
    box.insertBefore(document.createTextNode("C"), box.firstChild);
    fireEvent.input(box);

    expect(onTemplateChange).toHaveBeenCalledWith(`C${VALUE_TOKEN}`);
  });
});

describe("selection in payload coordinates", () => {
  function painted(template: string): HTMLElement {
    const el = document.createElement("div");
    document.body.append(el);
    paintTemplate(el, template);
    return el;
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  function select(el: HTMLElement, start: number, end: number) {
    // Place the caret via the editor's own helper, then stretch to `end`
    setCaret(el, start);
    const selection = document.getSelection();
    if (start !== end) {
      setCaret(el, end);
      const to = document.getSelection()?.getRangeAt(0);
      setCaret(el, start);
      const range = document.getSelection()?.getRangeAt(0);
      if (range && to) range.setEnd(to.startContainer, to.startOffset);
      if (range) {
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  it("counts the chip as the one character it stands for", () => {
    const el = painted(`{"b":${VALUE_TOKEN}}`);
    select(el, 7, 7);
    expect(readSelectionOffsets(el)).toEqual({ start: 7, end: 7 });
  });

  it("reads a selection spanning text and chip alike", () => {
    const el = painted(`{"b":${VALUE_TOKEN}}`);
    select(el, 5, 6);
    expect(readSelectionOffsets(el)).toEqual({ start: 5, end: 6 });
  });

  it("round-trips a caret through set and read", () => {
    const el = painted('{"brightness":128}');
    for (const offset of [0, 5, 14, 18]) {
      setCaret(el, offset);
      expect(readSelectionOffsets(el)).toEqual({ start: offset, end: offset });
    }
  });

  it("puts an offset on a chip's leading edge before it, not after", () => {
    const el = painted(`${VALUE_TOKEN}C`);
    setCaret(el, 0);
    expect(readSelectionOffsets(el)).toEqual({ start: 0, end: 0 });
    setCaret(el, 1);
    expect(readSelectionOffsets(el)).toEqual({ start: 1, end: 1 });
  });

  it("reports nothing when the selection is outside the editor", () => {
    const el = painted("abc");
    const outside = document.createElement("div");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(readSelectionOffsets(el)).toBeNull();
  });
});

describe("moving and deleting the chip", () => {
  afterEach(cleanup);

  function Harness({ initial }: { initial: string }) {
    const [template, setTemplate] = useState(initial);
    return (
      <PayloadBuilder
        template={template}
        onTemplateChange={setTemplate}
        previews={[{ key: "", value: "50" }]}
        brokerId="b1"
        topic="home/lamp"
      />
    );
  }

  function open(initial: string) {
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByText(/Edit/));
    return screen.getByRole("textbox");
  }

  function selectRange(box: HTMLElement, start: number, end: number) {
    setCaret(box, end);
    const to = document.getSelection()?.getRangeAt(0);
    setCaret(box, start);
    const range = document.getSelection()?.getRangeAt(0);
    if (range && to) range.setEnd(to.startContainer, to.startOffset);
  }

  const drop = () =>
    fireEvent.mouseDown(screen.getByText(/value$/, { selector: "button" }));

  it("hands back the text the chip replaced when it moves on", () => {
    const box = open('{"b":128}');
    selectRange(box, 5, 8);
    drop();
    expect(readTemplate(box)).toBe(`{"b":${VALUE_TOKEN}}`);

    // Move it to the end: the 128 it covered belongs back where it was
    setCaret(box, 7);
    drop();
    expect(readTemplate(box)).toBe(`{"b":128}${VALUE_TOKEN}`);
  });

  it("leaves nothing behind when the chip was dropped on empty space", () => {
    const box = open('{"b":}');
    setCaret(box, 5);
    drop();
    expect(readTemplate(box)).toBe(`{"b":${VALUE_TOKEN}}`);

    setCaret(box, 7);
    drop();
    expect(readTemplate(box)).toBe(`{"b":}${VALUE_TOKEN}`);
  });

  it("removing the chip leaves what it covered, not the demo value", () => {
    const box = open('{"b":128}');
    selectRange(box, 5, 8);
    drop();
    expect(readTemplate(box)).toBe(`{"b":${VALUE_TOKEN}}`);

    fireEvent.click(screen.getByText(/✕/));
    expect(readTemplate(box)).toBe('{"b":128}');
  });

  it("removing a chip that covered nothing leaves nothing", () => {
    const box = open('{"b":}');
    setCaret(box, 5);
    drop();
    expect(readTemplate(box)).toBe(`{"b":${VALUE_TOKEN}}`);

    fireEvent.click(screen.getByText(/✕/));
    expect(readTemplate(box)).toBe('{"b":}');
  });

  it("reads an emptied chip as deleted, husk and all", () => {
    const box = open(`{"b":${VALUE_TOKEN}}`);
    // What a browser can leave behind when the chip is backspaced away
    const chip = box.querySelector(`[${TOKEN_ATTR}]`) as HTMLElement;
    chip.textContent = "";
    expect(readTemplate(box)).toBe('{"b":}');
  });
});
