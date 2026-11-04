import type { ReactNode } from "react";
import { RiAddLine } from "react-icons/ri";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  findLiterals,
  placeToken,
  readShape,
  swapOrMarkLiteral,
} from "../payloadShape";

export interface Selection {
  start: number;
  end: number;
}

export interface ValueChipControlsProps {
  value: string;
  onChange: (next: string) => void;
  getSelection: () => Selection | null;
  onCaret?: (offset: number) => void;
  onCoveredChange: (covered: string) => void;
  covered?: string;
  mode: "write" | "read";
  history?: ReactNode;
  availableTokens?: Array<{ name: string; token: string; label: string }>;
  latestPayload?: string;
}

export default function ValueChipControls({
  value,
  onChange,
  getSelection,
  onCaret,
  onCoveredChange,
  covered = "",
  mode,
  history,
  availableTokens,
  latestPayload,
}: ValueChipControlsProps) {
  const literals = findLiterals(value);

  const handleLiteralClick = (literal: (typeof literals)[0]) => {
    let fallback: string | undefined;
    if (latestPayload && mode === "read") {
      const read = readShape(value, latestPayload);
      if (read.found && read.text) {
        fallback = read.text;
      }
    }

    const result = swapOrMarkLiteral(value, literal, covered, fallback);
    onCoveredChange(result.previous);
    onChange(result.template);
    onCaret?.(result.caret);
  };

  const place = (token: string = VALUE_TOKEN) => {
    const at = getSelection() ?? { start: value.length, end: value.length };
    const placed = placeToken(value, at.start, at.end, token);
    onCaret?.(placed.caret);
    onCoveredChange(placed.covered);
    onChange(placed.template);
  };

  const tokens = availableTokens ?? [
    { name: "value", token: VALUE_TOKEN, label: TOKEN_LABEL },
  ];

  return (
    <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {/* Quick token insert buttons */}
        {tokens.map((t) => (
          <button
            key={t.name}
            type="button"
            title={
              mode === "read"
                ? `Mark ${t.token} extraction target`
                : `Insert ${t.token} token`
            }
            onMouseDown={(e) => {
              e.preventDefault();
              place(t.token);
            }}
            className="btn btn-xs btn-outline btn-primary rounded-full font-mono gap-1 h-6 min-h-0 text-[11px] cursor-pointer"
          >
            <RiAddLine className="w-3 h-3" />
            <span>{t.label}</span>
          </button>
        ))}

        {/* Detected literals for 1-tap replacement */}
        {literals.map((literal) => (
          <button
            key={`${literal.start}-${literal.text}`}
            type="button"
            title={
              literal.key
                ? `Replace ${literal.key}: "${literal.text}" with ${VALUE_TOKEN}`
                : `Replace "${literal.text}" with ${VALUE_TOKEN}`
            }
            onClick={() => handleLiteralClick(literal)}
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
