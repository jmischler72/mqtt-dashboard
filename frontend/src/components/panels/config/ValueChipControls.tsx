import type { ReactNode } from "react";
import { RiAddLine } from "react-icons/ri";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  findLiterals,
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
  onCoveredChange: (covered: string, tokenIndex?: number) => void;
  /** "read" marks the value to pull out; "write" marks where one drops in. */
  mode: "write" | "read";
  /** Dropdown or controls for sample message history. */
  history?: ReactNode;
}

/**
 * The chip controls under the bytes box: insert `{value}` marks or hand
 * it straight to a literal already in the box.
 */
export default function ValueChipControls({
  value,
  onChange,
  getSelection,
  onCaret,
  covered,
  onCoveredChange,
  mode,
  history,
}: ValueChipControlsProps) {
  const literals = findLiterals(value);

  const place = () => {
    // No caret in the box yet: the end of the payload is the honest guess.
    const at = getSelection() ?? { start: value.length, end: value.length };
    const placed = placeToken(value, at.start, at.end, covered);
    const tokenIndex = value.slice(0, at.start).split(VALUE_TOKEN).length - 1;
    onCaret?.(placed.caret);
    onCoveredChange(placed.covered, tokenIndex);
    onChange(placed.template);
  };

  return (
    <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <button
          type="button"
          title={
            mode === "read"
              ? "Mark the part of the message the panel reads: click where it sits, or select it first"
              : "Insert {value}: click where it goes, or select the text it replaces"
          }
          // mousedown, not click: the default would move focus out of the box
          // and take the selection being aimed at with it.
          onMouseDown={(e) => {
            e.preventDefault();
            place();
          }}
          className="btn btn-xs btn-outline btn-primary rounded-full font-mono gap-1 h-6 min-h-0 text-[11px] cursor-pointer"
        >
          <RiAddLine className="w-3 h-3" />
          <span>{TOKEN_LABEL}</span>
        </button>

        {literals.map((literal) => (
          <button
            key={`${literal.start}-${literal.text}`}
            type="button"
            title={`Replace "${literal.text}" with {${TOKEN_LABEL}}`}
            onClick={() => {
              const result = markLiteral(value, literal, covered);
              const tokenIndex =
                value.slice(0, literal.start).split(VALUE_TOKEN).length - 1;
              onCoveredChange(result.previous, tokenIndex);
              onChange(result.template);
              onCaret?.(
                literal.start +
                  (literal.text.startsWith('"')
                    ? VALUE_TOKEN.length + 2
                    : VALUE_TOKEN.length),
              );
            }}
            className="badge badge-sm badge-outline hover:badge-primary font-mono cursor-pointer transition-colors h-6 px-2 text-[11px]"
          >
            {literal.text}
          </button>
        ))}
      </div>

      {history && (
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {history}
        </div>
      )}
    </div>
  );
}
