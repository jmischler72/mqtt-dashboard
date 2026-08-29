import { TOKEN_LABEL, VALUE_TOKEN } from "./payloadShape";

/**
 * The payload editor is a contenteditable rather than a textarea, so the token
 * can be a chip the user reads as "the panel's value" instead of a lone glyph
 * they have to be told about. These two functions are the whole contract:
 * `paintTemplate` turns the stored string into DOM, `readTemplate` turns the
 * DOM back into the string. Everything between them is the browser's own text
 * editing.
 */

/** Marks the chip, so it reads back as the token and is never typed into. */
export const TOKEN_ATTR = "data-value-token";

const CHIP_CLASS =
  "inline-flex items-center h-5 px-2 mx-0.5 align-middle rounded-full " +
  "border border-primary bg-primary/15 text-primary font-mono text-[11px] " +
  "select-none";

/** Replace the host's content with the template, token rendered as a chip. */
export function paintTemplate(host: HTMLElement, template: string): void {
  const nodes: Node[] = [];

  template.split(VALUE_TOKEN).forEach((chunk, index) => {
    if (index > 0) nodes.push(buildChip(host.ownerDocument));
    if (chunk) nodes.push(host.ownerDocument.createTextNode(chunk));
  });

  host.replaceChildren(...nodes);
}

function buildChip(doc: Document): HTMLElement {
  const chip = doc.createElement("span");
  chip.setAttribute(TOKEN_ATTR, "");
  // Atomic: the caret cannot land inside it, and backspace removes the whole
  // chip rather than eating one letter of the word "value".
  chip.setAttribute("contenteditable", "false");
  chip.className = CHIP_CLASS;
  chip.textContent = TOKEN_LABEL;
  return chip;
}

/**
 * Read the host back as a payload string. Browsers represent a newline in a
 * contenteditable as a `<br>` or as a fresh block element depending on how it
 * was produced, so both are mapped back to "\n".
 */
export function readTemplate(host: Node): string {
  let out = "";

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    if (node.hasAttribute(TOKEN_ATTR)) {
      // Browsers do not always remove the whole chip: some empty it out and
      // leave the husk behind. A chip that no longer reads as itself has been
      // deleted, whatever the DOM still holds.
      if (node.textContent === TOKEN_LABEL) out += VALUE_TOKEN;
      return;
    }

    if (node.tagName === "BR") {
      out += "\n";
      return;
    }

    // A block element starts a line, unless we are already at the start of one
    const isBlock = node.tagName === "DIV" || node.tagName === "P";
    if (isBlock && out && !out.endsWith("\n")) out += "\n";

    node.childNodes.forEach(walk);
  };

  host.childNodes.forEach(walk);

  return out;
}

/**
 * Where the selection sits, counted in payload characters rather than DOM
 * positions — the chip counts as the single token character it stands for.
 * Measured by cloning the content up to each end and reading it back, so it
 * holds up whatever shape the browser has made of the box.
 *
 * Null when nothing in the editor is selected, e.g. the user has not put the
 * caret in it yet.
 */
export function readSelectionOffsets(
  host: HTMLElement,
): { start: number; end: number } | null {
  const selection = host.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!host.contains(range.commonAncestorContainer)) return null;

  const upTo = (container: Node, offset: number) => {
    const measured = host.ownerDocument.createRange();
    measured.selectNodeContents(host);
    measured.setEnd(container, offset);
    return readTemplate(measured.cloneContents()).length;
  };

  return {
    start: upTo(range.startContainer, range.startOffset),
    end: upTo(range.endContainer, range.endOffset),
  };
}

/**
 * Put the caret at a payload offset. Only valid on a freshly painted box, whose
 * children are a flat run of text nodes and chips.
 */
export function setCaret(host: HTMLElement, offset: number): void {
  const selection = host.ownerDocument.getSelection();
  if (!selection) return;

  const range = host.ownerDocument.createRange();
  let seen = 0;
  let placed = false;

  for (let index = 0; index < host.childNodes.length; index++) {
    const node = host.childNodes[index];

    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (offset <= seen + length) {
        range.setStart(node, offset - seen);
        placed = true;
        break;
      }
      seen += length;
      continue;
    }

    // A chip is one character wide, and the caret can only sit beside it
    seen += 1;
    if (offset <= seen) {
      range.setStart(host, index + 1);
      placed = true;
      break;
    }
  }

  if (!placed) range.setStart(host, host.childNodes.length);

  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
