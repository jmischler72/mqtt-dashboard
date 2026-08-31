import {
  TOKEN_LABEL,
  clearToken,
  findLiterals,
  hasToken,
  markLiteral,
  placeToken,
} from "../payloadShape";

export interface Selection {
  start: number;
  end: number;
}

export interface ValueChipControlsProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * Where the caret is in the box, read at click time rather than at render:
   * the selection changes without re-rendering, and a stale copy would drop the
   * chip in the wrong place.
   */
  getSelection: () => Selection | null;
  /**
   * Where the caret belongs once the chip has been placed — just past it, so
   * the box can be typed in straight after. Omitted when the caller does not
   * drive the caret itself.
   */
  onCaret?: (offset: number) => void;
  /**
   * The text the chip currently covers. Remembered so removing the chip puts
   * back exactly what it replaced rather than a value the user never typed.
   */
  covered: string;
  onCoveredChange: (covered: string) => void;
  /** "read" marks the value to pull out; "write" marks where one drops in. */
  mode: "write" | "read";
}

/**
 * The chip controls under the bytes box: place the one `{value}` mark, move it,
 * take it away, or hand it straight to a literal already in the box.
 *
 * There is exactly one mark and it works in both directions — the same chip
 * that says "the panel's value goes here" when publishing says "read the value
 * from here" when subscribing.
 */
export default function ValueChipControls({
  value,
  onChange,
  getSelection,
  onCaret,
  covered,
  onCoveredChange,
  mode,
}: ValueChipControlsProps) {
  const present = hasToken(value);
  const literals = findLiterals(value);

  const place = () => {
    // No caret in the box yet: the end of the payload is the honest guess.
    const at = getSelection() ?? { start: value.length, end: value.length };
    // Whatever this drop covers is what a later removal hands back: the text
    // the user actually replaced, never a value they never typed.
    const placed = placeToken(value, at.start, at.end, covered);
    onCaret?.(placed.caret);
    onCoveredChange(placed.covered);
    onChange(placed.template);
  };

  const hint = present
    ? "Put the caret where the chip should go instead, then move it. Everything around it is ordinary text."
    : mode === "read"
      ? "Drop the value chip on the part of the message the panel should read — select text to replace it, or tap one of the values below."
      : "Drop the value chip where the panel's value goes — select text to replace it, or tap one of the values below.";

  return (
    <div className="flex flex-col gap-[7px] min-w-0">
      <span className="text-[11px] leading-relaxed text-base-content/70">
        {hint}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          title={
            present
              ? "Move the value chip to the caret"
              : "Drop the value chip at the caret"
          }
          // mousedown, not click: the default would move focus out of the box
          // and take the selection being aimed at with it.
          onMouseDown={(e) => {
            e.preventDefault();
            place();
          }}
          className="inline-flex items-center h-6 px-2.5 rounded-full border border-primary bg-primary/10 font-mono text-[11px] cursor-pointer"
        >
          {present ? `↦ move ${TOKEN_LABEL}` : `+ ${TOKEN_LABEL}`}
        </button>

        {present && (
          <button
            type="button"
            title="Remove the value chip"
            onClick={() => {
              onChange(clearToken(value, covered));
              onCoveredChange("");
            }}
            className="inline-flex items-center h-6 px-2.5 rounded-full border border-base-300 dark:border-base-100 bg-base-100 font-mono text-[11px] text-base-content/70 cursor-pointer"
          >
            {TOKEN_LABEL} ✕
          </button>
        )}

        {literals.map((literal) => (
          <button
            key={`${literal.start}-${literal.text}`}
            type="button"
            title={`Make ${literal.text} the value chip`}
            onClick={() => {
              const result = markLiteral(value, literal, covered);
              onCoveredChange(result.previous);
              onChange(result.template);
            }}
            className="inline-flex items-center h-6 px-2.5 rounded-full border border-base-300 dark:border-base-100 bg-base-100 font-mono text-[11px] cursor-pointer hover:border-primary"
          >
            {literal.text}
          </button>
        ))}
      </div>
    </div>
  );
}
