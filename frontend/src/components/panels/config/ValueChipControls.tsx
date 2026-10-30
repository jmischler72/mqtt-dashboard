import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { RiAddLine, RiArrowDownSLine } from "react-icons/ri";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  clearToken,
  deriveReadPath,
  findLiterals,
  firstTopic,
  hasToken,
  inferCoveredValue,
  markLiteral,
  parseTemplateChunks,
  placeToken,
  unwrapToken,
  type TemplateLiteral,
  type TokenOption,
} from "../payloadShape";

export interface Selection {
  start: number;
  end: number;
}

export interface ValueChipControlsProps {
  value: string;
  covered?: string;
  onChange: (next: string) => void;
  getSelection: () => Selection | null;
  onCaret?: (offset: number) => void;
  onCoveredChange?: (covered: string, tokenIndex?: number) => void;
  mode: "write" | "read";
  samplePayload?: string | null;
  topic?: string;
  previewValue?: string;
  availableTokens?: TokenOption[];
  history?: ReactNode;
}

function getTokenPreview(
  token: string,
  topic?: string,
  samplePayload?: string | null,
  previewValue?: string,
): string {
  const norm = unwrapToken(token);
  if (norm === "value") {
    return previewValue || "21.5";
  }
  if (norm === "topic") {
    return firstTopic(topic) || "sensor/temp";
  }
  if (norm === "payload") {
    if (samplePayload) {
      const trimmed = samplePayload.trim();
      return trimmed.length > 16 ? trimmed.slice(0, 16) + "…" : trimmed;
    }
    return '{"temp":21.5}';
  }
  if (norm === "timestamp") {
    return String(Math.floor(Date.now() / 1000));
  }
  if (norm === "timestamp:ms") {
    return String(Date.now());
  }
  if (norm === "timestamp:iso" || norm === "iso_timestamp") {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  if (norm.startsWith("value:")) {
    const firstPreview = previewValue?.split(/[,|]/)[0]?.trim();
    return firstPreview || "21.5";
  }
  return norm;
}

function findTargetLiteral(
  source: string,
  literal: TemplateLiteral,
): TemplateLiteral | null {
  const candidates = findLiterals(source, Infinity);
  if (literal.key) {
    const byKey = candidates.find(
      (l) => l.key === literal.key && l.text === literal.text,
    );
    if (byKey) return byKey;
  }
  const byText = candidates.find((l) => l.text === literal.text);
  if (byText) return byText;
  return null;
}

function countTokensBefore(source: string, offset: number): number {
  return parseTemplateChunks(source.slice(0, offset)).filter(
    (c) => c.type === "token",
  ).length;
}

export default function ValueChipControls({
  value,
  covered,
  onChange,
  getSelection,
  onCaret,
  onCoveredChange,
  mode,
  samplePayload,
  topic,
  previewValue,
  availableTokens,
  history,
}: ValueChipControlsProps) {
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const [tokenPos, setTokenPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const tokenButtonRef = useRef<HTMLButtonElement>(null);
  const tokenMenuRef = useRef<HTMLDivElement>(null);

  const [literalMenuOpen, setLiteralMenuOpen] = useState(false);
  const [literalPos, setLiteralPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const literalButtonRef = useRef<HTMLButtonElement>(null);
  const literalMenuRef = useRef<HTMLDivElement>(null);

  const isAlreadyMarked = hasToken(value);

  // Combine literals from sample payload (incoming broker messages) and editor value
  const literals = useMemo(() => {
    const candidates: TemplateLiteral[] = [];
    const seen = new Set<string>();

    // Identify which field/path or literal is already occupied by the token
    const activePath = hasToken(value) ? deriveReadPath(value) : null;
    const coveredVal = hasToken(value)
      ? (covered || inferCoveredValue(value, samplePayload)).trim()
      : "";

    const isCurrentTokenField = (lit: TemplateLiteral): boolean => {
      const cleanLit = lit.text.replace(/^["']|["']$/g, "").trim().toLowerCase();
      const cleanCovered = coveredVal.replace(/^["']|["']$/g, "").trim().toLowerCase();

      if (activePath) {
        // Literals without a key (e.g. raw "OFF" from sample payload) cannot be fields
        // in a structured JSON template and should not be offered
        if (!lit.key) {
          return true;
        }
        const lastSegment = activePath.split(".").pop()?.toLowerCase();
        if (
          lit.key.toLowerCase() === activePath.toLowerCase() ||
          lit.key.toLowerCase() === lastSegment
        ) {
          return true;
        }
      }

      if (cleanCovered && cleanLit === cleanCovered) {
        return true;
      }
      if (previewValue) {
        const previewTokens = previewValue
          .split(/[,|]/)
          .map((v) => v.replace(/^["']|["']$/g, "").trim().toLowerCase());
        if (previewTokens.includes(cleanLit)) {
          return true;
        }
      }
      return false;
    };

    if (samplePayload && samplePayload.trim()) {
      for (const lit of findLiterals(samplePayload, 12)) {
        if (isCurrentTokenField(lit)) continue;
        const id = lit.key ? `${lit.key}:${lit.text}` : lit.text;
        if (!seen.has(id)) {
          seen.add(id);
          candidates.push(lit);
        }
      }
    }

    for (const lit of findLiterals(value, 12)) {
      if (isCurrentTokenField(lit)) continue;
      const id = lit.key ? `${lit.key}:${lit.text}` : lit.text;
      if (!seen.has(id)) {
        seen.add(id);
        candidates.push(lit);
      }
    }

    return candidates;
  }, [value, samplePayload, covered, previewValue]);

  const inlineLiterals = literals.slice(0, 2);
  const overflowLiterals = literals.slice(2);

  // Position and toggle portal token dropdown
  const toggleTokenMenu = () => {
    if (!tokenMenuOpen && tokenButtonRef.current) {
      const rect = tokenButtonRef.current.getBoundingClientRect();
      const menuHeight = 280;
      const top =
        rect.bottom + menuHeight > window.innerHeight && rect.top > menuHeight
          ? Math.max(8, rect.top - menuHeight - 4)
          : rect.bottom + 4;
      setTokenPos({
        top,
        left: Math.max(8, Math.min(window.innerWidth - 290, rect.left)),
      });
      setTokenMenuOpen(true);
    } else {
      setTokenMenuOpen(false);
    }
  };

  // Position and toggle portal literal dropdown
  const toggleLiteralMenu = () => {
    if (!literalMenuOpen && literalButtonRef.current) {
      const rect = literalButtonRef.current.getBoundingClientRect();
      const menuHeight = 250;
      const top =
        rect.bottom + menuHeight > window.innerHeight && rect.top > menuHeight
          ? Math.max(8, rect.top - menuHeight - 4)
          : rect.bottom + 4;
      setLiteralPos({
        top,
        left: Math.max(8, Math.min(window.innerWidth - 270, rect.left)),
      });
      setLiteralMenuOpen(true);
    } else {
      setLiteralMenuOpen(false);
    }
  };

  // Close menus on outside click or scroll
  useEffect(() => {
    if (!tokenMenuOpen && !literalMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        tokenMenuOpen &&
        tokenMenuRef.current &&
        !tokenMenuRef.current.contains(target) &&
        !tokenButtonRef.current?.contains(target)
      ) {
        setTokenMenuOpen(false);
      }
      if (
        literalMenuOpen &&
        literalMenuRef.current &&
        !literalMenuRef.current.contains(target) &&
        !literalButtonRef.current?.contains(target)
      ) {
        setLiteralMenuOpen(false);
      }
    };

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (
        tokenMenuRef.current?.contains(target) ||
        literalMenuRef.current?.contains(target)
      ) {
        return;
      }
      setTokenMenuOpen(false);
      setLiteralMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [tokenMenuOpen, literalMenuOpen]);

  const place = (tokenStr = VALUE_TOKEN) => {
    const at = getSelection() ?? { start: value.length, end: value.length };

    // In read mode, ensure strictly at most one token can ever exist
    if (mode === "read" && isAlreadyMarked) {
      if (at.start !== at.end) {
        // Selection highlighted: replace old mark with this selection
        const match = value.match(/\{\{value\}\}|\{value\}/);
        if (match && match.index !== undefined) {
          const oldStart = match.index;
          const oldLen = match[0].length;
          const oldEnd = oldStart + oldLen;
          const restore = covered || inferCoveredValue(value, samplePayload);

          if (at.start < oldEnd && at.end > oldStart) {
            // Selection overlaps or covers the old mark
            const placed = placeToken(value, at.start, at.end, tokenStr);
            onCaret?.(placed.caret);
            onCoveredChange?.(placed.covered, 0);
            onChange(placed.template);
            return;
          }

          // Selection is before or after the old mark: restore old mark and adjust offsets
          const delta = restore.length - oldLen;
          const newStart = at.start < oldStart ? at.start : at.start + delta;
          const newEnd = at.end < oldStart ? at.end : at.end + delta;
          const restored =
            value.slice(0, oldStart) + restore + value.slice(oldEnd);
          const placed = placeToken(restored, newStart, newEnd, tokenStr);
          onCaret?.(placed.caret);
          onCoveredChange?.(placed.covered, 0);
          onChange(placed.template);
          return;
        }

        // Fallback if match wasn't found
        const restore = covered || inferCoveredValue(value, samplePayload);
        const cleaned = clearToken(value, restore);
        const placed = placeToken(cleaned, at.start, at.end, tokenStr);
        onCaret?.(placed.caret);
        onCoveredChange?.(placed.covered, 0);
        onChange(placed.template);
      }
      return;
    }

    const placed = placeToken(value, at.start, at.end, tokenStr);
    const tokenIndex = countTokensBefore(value, at.start);
    onCaret?.(placed.caret);
    onCoveredChange?.(placed.covered, tokenIndex);
    onChange(placed.template);
  };

  const handleApplyLiteral = useCallback(
    (literal: TemplateLiteral) => {
      const activeCovered = covered || inferCoveredValue(value, samplePayload);

      // If current value (with previous mark restored) already contains this literal,
      // prefer keeping user's custom template modifications
      let base = value;
      if (hasToken(base)) {
        base = clearToken(base, activeCovered || "0");
      }

      const targetInBase = base ? findTargetLiteral(base, literal) : null;
      if (targetInBase) {
        const result = markLiteral(base, targetInBase);
        const tokenIndex = countTokensBefore(base, targetInBase.start);
        onCoveredChange?.(result.previous, tokenIndex);
        onChange(result.template);
        onCaret?.(
          targetInBase.start +
            (targetInBase.text.startsWith('"')
              ? VALUE_TOKEN.length + 2
              : VALUE_TOKEN.length),
        );
        return;
      }

      // If literal is from samplePayload and not in current value:
      if (samplePayload) {
        const targetInSample = findTargetLiteral(samplePayload, literal);
        if (targetInSample) {
          const result = markLiteral(samplePayload, targetInSample);
          onCoveredChange?.(result.previous, 0);
          onChange(result.template);
          onCaret?.(
            targetInSample.start +
              (targetInSample.text.startsWith('"')
                ? VALUE_TOKEN.length + 2
                : VALUE_TOKEN.length),
          );
          return;
        }
      }

      const fallbackBase = value || samplePayload || "";
      const target = findTargetLiteral(fallbackBase, literal) ?? literal;
      const result = markLiteral(fallbackBase, target);
      const tokenIndex = countTokensBefore(fallbackBase, target.start);
      onCoveredChange?.(result.previous, tokenIndex);
      onChange(result.template);
      onCaret?.(
        target.start +
          (target.text.startsWith('"')
            ? VALUE_TOKEN.length + 2
            : VALUE_TOKEN.length),
      );
    },
    [samplePayload, value, covered, onCoveredChange, onChange, onCaret],
  );

  const tokensToRender: TokenOption[] = useMemo(() => {
    if (mode === "read") {
      return [
        {
          name: "value",
          token: VALUE_TOKEN,
          label: TOKEN_LABEL,
          title: isAlreadyMarked
            ? "Reading value is already marked (select text in box to move it)"
            : "Mark the part of the message the panel reads: click where it sits, or select it first",
        },
      ];
    }

    return (
      availableTokens ?? [
        {
          name: "value",
          token: VALUE_TOKEN,
          label: TOKEN_LABEL,
          title:
            "Insert {{value}}: click where it goes, or select the text it replaces",
        },
        {
          name: "topic",
          token: "{{topic}}",
          label: "topic",
          title:
            "Insert {{topic}}: click where it goes, or select the text it replaces",
        },
        {
          name: "timestamp",
          token: "{{timestamp}}",
          label: "timestamp",
          title: "Insert {{timestamp}}: current Unix timestamp",
        },
        {
          name: "timestamp:iso",
          token: "{{timestamp:iso}}",
          label: "iso time",
          title: "Insert {{timestamp:iso}}: current ISO 8601 timestamp",
        },
      ]
    );
  }, [mode, isAlreadyMarked, availableTokens]);

  const primaryToken = tokensToRender[0] ?? {
    name: "value",
    token: VALUE_TOKEN,
    label: TOKEN_LABEL,
  };
  const secondaryTokens = tokensToRender.slice(1);

  return (
    <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {secondaryTokens.length === 0 ? (
          <button
            type="button"
            title={primaryToken.title || `Insert ${primaryToken.token}`}
            onMouseDown={(e) => {
              e.preventDefault();
              place(primaryToken.token);
            }}
            className="btn btn-xs btn-outline btn-primary rounded-full font-mono gap-1 h-6 min-h-0 text-[11px] cursor-pointer"
          >
            <RiAddLine className="w-3 h-3" />
            <span>{primaryToken.label || primaryToken.name}</span>
          </button>
        ) : (
          <div className="join inline-flex items-center">
            <button
              type="button"
              title={
                primaryToken.title ||
                `Insert ${primaryToken.token}: click where it goes, or select the text it replaces`
              }
              onMouseDown={(e) => {
                e.preventDefault();
                place(primaryToken.token);
              }}
              className="join-item btn btn-xs btn-outline btn-primary rounded-l-full font-mono gap-1 h-6 min-h-0 text-[11px] cursor-pointer pr-2"
            >
              <RiAddLine className="w-3 h-3" />
              <span>{primaryToken.label || primaryToken.name}</span>
            </button>

            <button
              ref={tokenButtonRef}
              type="button"
              tabIndex={0}
              title="Insert context tokens"
              aria-expanded={tokenMenuOpen}
              onClick={toggleTokenMenu}
              className={`join-item btn btn-xs btn-outline btn-primary rounded-r-full font-mono px-1.5 h-6 min-h-0 text-[11px] cursor-pointer border-l-0 ${
                tokenMenuOpen ? "bg-primary text-primary-content" : ""
              }`}
            >
              <RiArrowDownSLine className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Portal-rendered Token Picker Menu */}
        {tokenMenuOpen &&
          createPortal(
            <div
              ref={tokenMenuRef}
              style={{
                position: "fixed",
                top: tokenPos.top,
                left: tokenPos.left,
                zIndex: 99999,
              }}
              className="p-1.5 shadow-2xl bg-base-200 border border-base-300 rounded-xl min-w-[17rem] max-w-sm max-h-72 overflow-y-auto font-mono text-[11px]"
            >
              <div className="px-2 py-1 text-[10px] font-semibold text-base-content/50 uppercase tracking-wider font-sans border-b border-base-300/60 mb-1">
                Context Tokens
              </div>
              <div className="space-y-0.5">
                {secondaryTokens.map((t) => {
                  const preview =
                    t.preview ??
                    getTokenPreview(
                      t.token,
                      topic,
                      samplePayload,
                      previewValue,
                    );
                  return (
                    <button
                      key={t.token}
                      type="button"
                      title={t.title || `Insert ${t.token}`}
                      aria-label={t.label || t.name}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        place(t.token);
                        setTokenMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg hover:bg-base-300 transition-colors text-left cursor-pointer group"
                    >
                      <span className="badge badge-sm badge-primary badge-outline font-mono font-medium text-[11px] shrink-0 group-hover:badge-primary group-hover:text-primary-content">
                        {t.label || t.name}
                      </span>
                      <span
                        className="text-[11px] text-base-content/60 font-mono truncate max-w-[130px] text-right"
                        title={preview}
                      >
                        {preview}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )}

        {/* Inline Detected Literals */}
        {inlineLiterals.map((literal) => (
          <button
            key={`${literal.start}-${literal.text}`}
            type="button"
            aria-label={literal.text}
            title={
              literal.key
                ? `Mark ${literal.key}: "${literal.text}" as {{${TOKEN_LABEL}}}`
                : `Mark "${literal.text}" as {{${TOKEN_LABEL}}}`
            }
            onClick={() => handleApplyLiteral(literal)}
            className="badge badge-sm badge-outline hover:badge-primary font-mono cursor-pointer transition-colors h-6 px-2 text-[11px] gap-1 max-w-[160px] truncate"
          >
            {literal.key && (
              <span className="text-[10px] font-sans truncate opacity-50">
                {literal.key}:
              </span>
            )}
            <span className="truncate">{literal.text}</span>
          </button>
        ))}

        {/* Overflow Literals Dropdown */}
        {overflowLiterals.length > 0 && (
          <>
            <button
              ref={literalButtonRef}
              type="button"
              tabIndex={0}
              title={`${overflowLiterals.length} more detected fields`}
              aria-expanded={literalMenuOpen}
              onClick={toggleLiteralMenu}
              className={`badge badge-sm font-mono cursor-pointer transition-colors h-6 px-1.5 text-[11px] gap-0.5 ${
                literalMenuOpen ? "badge-neutral" : "badge-ghost hover:badge-neutral"
              }`}
            >
              <span>+{overflowLiterals.length} more</span>
              <RiArrowDownSLine className="w-3 h-3" />
            </button>

            {literalMenuOpen &&
              createPortal(
                <div
                  ref={literalMenuRef}
                  style={{
                    position: "fixed",
                    top: literalPos.top,
                    left: literalPos.left,
                    zIndex: 99999,
                  }}
                  className="p-1.5 shadow-2xl bg-base-200 border border-base-300 rounded-xl min-w-[16rem] max-w-sm max-h-64 overflow-y-auto font-mono text-[11px]"
                >
                  <div className="px-2 py-1 text-[10px] font-semibold text-base-content/50 uppercase tracking-wider font-sans border-b border-base-300/60 mb-1">
                    Detected Fields
                  </div>
                  <div className="space-y-0.5">
                    {overflowLiterals.map((literal) => (
                      <button
                        key={`${literal.start}-${literal.text}`}
                        type="button"
                        aria-label={literal.text}
                        title={
                          literal.key
                            ? `Mark ${literal.key}: "${literal.text}" as {{${TOKEN_LABEL}}}`
                            : `Mark "${literal.text}" as {{${TOKEN_LABEL}}}`
                        }
                        onClick={() => {
                          handleApplyLiteral(literal);
                          setLiteralMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left cursor-pointer hover:bg-base-300"
                      >
                        <span className="badge badge-sm badge-outline font-mono text-[11px] gap-1 shrink-0">
                          {literal.key && (
                            <span className="opacity-60 text-[10px] font-sans">
                              {literal.key}:
                            </span>
                          )}
                          <span className="font-mono">{literal.text}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>,
                document.body,
              )}
          </>
        )}
      </div>

      {history && (
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {history}
        </div>
      )}
    </div>
  );
}
