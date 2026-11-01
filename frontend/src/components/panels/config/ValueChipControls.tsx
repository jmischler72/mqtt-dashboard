import type { ReactNode } from "react";
import { RiAddLine, RiCloseLine } from "react-icons/ri";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
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
  getSelection: () => Selection | null;
  onCaret?: (offset: number) => void;
  onCoveredChange: (covered: string, tokenIndex?: number) => void;
  covered?: string;
  mode: "write" | "read";
  history?: ReactNode;
  availableTokens?: Array<{ name: string; token: string; label: string }>;
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
}: ValueChipControlsProps) {
  const literals = findLiterals(value);
  const tokenActive = hasToken(value);

  const place = (token: string = VALUE_TOKEN) => {
    const at = getSelection() ?? { start: value.length, end: value.length };
    const placed = placeToken(value, at.start, at.end, token);
    const tokenIndex = value.slice(0, at.start).split(VALUE_TOKEN).length - 1;
    onCaret?.(placed.caret);
    onCoveredChange(placed.covered, tokenIndex);
    onChange(placed.template);
  };

  const tokens = availableTokens ?? [
    { name: "value", token: VALUE_TOKEN, label: TOKEN_LABEL },
  ];

  return (
    <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {/* Active token badge with remove/restore button */}
        {tokenActive ? (
          <span
            data-value-token
            className="badge badge-sm badge-primary gap-1 font-mono h-6 px-2 text-[11px]"
          >
            <span>{TOKEN_LABEL}</span>
            <button
              type="button"
              data-remove-token
              title={covered ? `Restore "${covered}"` : "Remove token"}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(clearToken(value, covered));
                onCoveredChange("");
              }}
              onClick={() => {
                onChange(clearToken(value, covered));
                onCoveredChange("");
              }}
              className="hover:opacity-75 cursor-pointer ml-0.5 inline-flex items-center"
            >
              <RiCloseLine className="w-3 h-3" />
            </button>
          </span>
        ) : null}

        {/* Quick token insert buttons */}
        {tokens.map((t) => (
          <button
            key={t.name}
            type="button"
            title={
              mode === "read"
                ? `Mark where value is read: click where it goes or select text`
                : `Insert ${t.token}`
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
            onClick={() => {
              const result = markLiteral(value, literal);
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
