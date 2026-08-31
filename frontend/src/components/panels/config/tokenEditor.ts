import { TOKEN_LABEL, VALUE_TOKEN } from "../payloadShape";

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

/** A DOM selection boundary, as a container node plus its offset. */
interface Boundary {
  container: Node;
  offset: number;
}

/**
 * Walk `host` building the payload string, recording where each boundary in
 * `marks` lands inside it.
 *
 * One walk serves both jobs on purpose. Measuring a selection used to clone the
 * content up to each end and read the clone back, but a `<br>` that is trailing
 * *in the clone* is not necessarily the browser's filler — cut the content at
 * the start of line two and the newline the user typed looks like filler and is
 * dropped, putting every offset after a line break one short. Only the live
 * tree can tell the two apart, so the boundaries are resolved against it.
 */
function walkHost(
  host: Node,
  marks: Boundary[],
): { text: string; at: number[] } {
  let out = "";
  const at: number[] = marks.map(() => -1);

  /** A boundary inside `node` resolves to the payload offset `resolve` gives. */
  const record = (matches: (mark: Boundary) => boolean) => {
    marks.forEach((mark, index) => {
      if (at[index] === -1 && matches(mark)) at[index] = out.length;
    });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const start = out.length;
      marks.forEach((mark, index) => {
        if (at[index] === -1 && mark.container === node) {
          at[index] = start + Math.min(mark.offset, text.length);
        }
      });
      out += text;
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    if (node.hasAttribute(TOKEN_ATTR)) {
      // The caret cannot sit inside a chip, so any point in it — the chip
      // itself or the text it holds — is its leading edge.
      record((mark) => node.contains(mark.container));
      // Browsers do not always remove the whole chip: some empty it out and
      // leave the husk behind. A chip that no longer reads as itself has been
      // deleted, whatever the DOM still holds.
      if (node.textContent === TOKEN_LABEL) out += VALUE_TOKEN;
      return;
    }

    if (node.tagName === "BR") {
      record((mark) => mark.container === node);
      // Browsers park a filler <br> at the end of editable content to keep the
      // last line reachable. It is not a line the user typed, and publishing
      // the newline it stands for would append a byte they cannot see.
      if (!isTrailingFiller(node, host)) out += "\n";
      return;
    }

    // A block element starts a line, unless we are already at the start of one
    const isBlock = node.tagName === "DIV" || node.tagName === "P";
    if (isBlock && out && !out.endsWith("\n")) out += "\n";

    walkChildren(node);
  };

  const walkChildren = (parent: Node) => {
    const children = parent.childNodes;
    for (let index = 0; index < children.length; index++) {
      // An offset on an element boundary counts children, not characters
      record((mark) => mark.container === parent && mark.offset === index);
      walk(children[index]);
    }
    record(
      (mark) => mark.container === parent && mark.offset >= children.length,
    );
  };

  walkChildren(host);

  return { text: out, at };
}

/**
 * Read the host back as a payload string. Browsers represent a newline in a
 * contenteditable as a `<br>` or as a fresh block element depending on how it
 * was produced, so both are mapped back to "\n".
 */
export function readTemplate(host: Node): string {
  return walkHost(host, []).text;
}

/** True for a <br> with nothing after it, anywhere up to the host. */
function isTrailingFiller(node: Node, host: Node): boolean {
  let current: Node | null = node;

  while (current && current !== host) {
    if (current.nextSibling) return false;
    current = current.parentNode;
  }

  return true;
}

/**
 * Where the selection sits, counted in payload characters rather than DOM
 * positions — the chip counts as the token it stands for.
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

  const { text, at } = walkHost(host, [
    { container: range.startContainer, offset: range.startOffset },
    { container: range.endContainer, offset: range.endOffset },
  ]);

  // A boundary the walk never reached sits past everything it did
  const start = at[0] === -1 ? text.length : at[0];
  const end = at[1] === -1 ? text.length : at[1];

  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Put the caret at a payload offset — the same offsets `readTemplate` and
 * `readSelectionOffsets` count in, where a chip is as wide as the token it
 * stands for. Only valid on a freshly painted box, whose children are a flat
 * run of text nodes and chips.
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

    // A chip stands for the whole token and the caret can only sit beside it:
    // on its leading edge that means before it, anywhere else in its span —
    // including the offset `placeToken` hands back — means after.
    if (offset <= seen) {
      range.setStart(host, index);
      placed = true;
      break;
    }
    seen += VALUE_TOKEN.length;
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
