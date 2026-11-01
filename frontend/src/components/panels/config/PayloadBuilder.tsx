import { useRef, useState } from "react";
import { RiCloseLine } from "react-icons/ri";
import {
  usePayloadSample,
  type RecentMessage,
} from "../../../hooks/usePayloadSample";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  detectPayloadMode,
  findLiterals,
  hasToken,
  parseTemplateChunks,
  readShape,
  renderPayload,
} from "../payloadShape";
import HighlightedTextarea, {
  type HighlightedTextareaHandle,
} from "./HighlightedTextarea";
import MessageHistory from "./MessageHistory";
import PreviewBox from "./PreviewBox";
import ValueChipControls, { type Selection } from "./ValueChipControls";

export interface PayloadHistory {
  messages: RecentMessage[];
  loading: boolean;
}

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

export interface PayloadBuilderProps {
  /**
   * "write" describes the bytes to publish; "read" describes the shape they
   * arrive in, where the chip marks the value to pull out instead of the one to
   * drop in.
   */
  mode: "write" | "read";
  value: string;
  onChange: (next: string) => void;
  topic: string;
  brokerId: string;
  history?: PayloadHistory;
  showHistory?: boolean;
  showPreview?: boolean;
  previewCard?: boolean;
  acceptsChip?: boolean;
  allowBlankShape?: boolean;
  readPath?: string;
  readsText?: boolean;
  placeholder?: string;
  range?: NumericRange | null;
  previewValue?: string;
  unit?: string;
  note?: string | null;
  availableTokens?: Array<{ name: string; token: string; label: string }>;
}

/**
 * The unified payload editor, used by every panel that reads or writes a payload.
 * Native textarea underlying with syntax-highlighted token backdrop.
 */
export default function PayloadBuilder({
  mode,
  value,
  onChange,
  topic,
  brokerId,
  history,
  showHistory = true,
  showPreview = true,
  previewCard,
  acceptsChip = true,
  allowBlankShape = false,
  readPath,
  readsText,
  placeholder,
  range,
  previewValue,
  unit,
  note,
  availableTokens,
}: PayloadBuilderProps) {
  const isPreviewCard = previewCard ?? Boolean(range);
  const [covered, setCovered] = useState("");
  const [usedIndex, setUsedIndex] = useState<number | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const textareaRef = useRef<HighlightedTextareaHandle>(null);
  const [selection, setSelection] = useState<Selection>({
    start: value.length,
    end: value.length,
  });

  const sampled = usePayloadSample(
    history ? "" : brokerId,
    history ? "" : topic,
  );
  const messages = history?.messages ?? sampled.recent;
  const loading = history?.loading ?? sampled.loading;
  const latest = messages[0] ?? null;

  const reading = mode === "read";
  const chip = hasToken(value);

  const useMessage = (payload: string, index: number) => {
    onChange(markFirstNumber(payload, acceptsChip));
    setCovered(acceptsChip ? (firstNumber(payload)?.text ?? "") : "");
    setUsedIndex(index);
    setPosition(null);
  };

  const detectedMode = detectPayloadMode(value);

  const renderModeIndicator = () => {
    if (reading) {
      if (detectedMode === "json" || readPath) {
        return (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-base-content/60 font-mono"
            title="Extracting via JSONPath"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
            JSON
          </span>
        );
      }
      if (chip) {
        return (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-base-content/60 font-mono"
            title="Extracting via text stencil"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
            Stencil
          </span>
        );
      }
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-base-content/60 font-mono"
          title="Whole payload as raw string"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-neutral shrink-0" />
          Raw
        </span>
      );
    }

    if (detectedMode === "json") {
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-base-content/60 font-mono"
          title="Structured JSON template"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
          JSON
        </span>
      );
    }
    if (chip) {
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-base-content/60 font-mono"
          title="Custom text template with variables"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
          Custom
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-base-content/60 font-mono"
        title="Plain text literal"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-neutral shrink-0" />
        Plain
      </span>
    );
  };

  const historyNode = showHistory ? (
    <MessageHistory
      topic={topic}
      messages={messages}
      loading={loading}
      actions={[{ key: "use", label: "use this message", onUse: useMessage }]}
      usedKey={usedIndex === null ? null : `${usedIndex}:use`}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Integrated editor container with border and embedded preview footer */}
      <div className="rounded-lg border border-base-300 dark:border-base-100 bg-base-300 overflow-hidden focus-within:border-primary transition-colors flex flex-col">
        <div className="relative">
          <HighlightedTextarea
            ref={textareaRef}
            value={value}
            onChange={(next) => {
              onChange(next);
              setUsedIndex(null);
            }}
            onSelectionChange={setSelection}
            placeholder={placeholder}
            rows={3}
            aria-label={reading ? "Message shape" : "Message"}
            className={value.length > 0 ? "pr-16" : "pr-12"}
          />

          <div className="absolute top-1.5 right-1.5 flex items-center gap-1.5 select-none z-10">
            {renderModeIndicator()}
            {value.length > 0 && (
              <button
                type="button"
                title="Clear message"
                aria-label="Clear message"
                onClick={() => {
                  onChange("");
                  setCovered("");
                  setUsedIndex(null);
                  setPosition(null);
                  textareaRef.current?.focus();
                }}
                className="btn btn-ghost btn-xs btn-square text-base-content/40 hover:text-base-content cursor-pointer"
              >
                <RiCloseLine className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {!showPreview || isPreviewCard ? null : reading ? (
          <ReadPreview
            value={value}
            latest={latest}
            topic={topic}
            chip={chip}
            allowBlankShape={allowBlankShape}
            readPath={readPath}
            readsText={readsText}
            unit={unit}
            asCard={false}
          />
        ) : (
          acceptsChip && (
            <WritePreview
              value={value}
              chip={chip}
              range={range ?? null}
              previewValue={previewValue}
              position={position}
              onPosition={setPosition}
              asCard={false}
            />
          )
        )}
      </div>

      {acceptsChip ? (
        <ValueChipControls
          mode={mode}
          value={value}
          covered={covered}
          history={historyNode}
          availableTokens={availableTokens}
          onChange={onChange}
          getSelection={() => textareaRef.current?.getSelection() ?? selection}
          onCaret={(at) => {
            textareaRef.current?.setSelection(at, at);
          }}
          onCoveredChange={(text) => {
            setCovered(text);
          }}
        />
      ) : (
        (historyNode || note) && (
          <div className="flex items-center justify-between gap-1.5 min-w-0 w-full">
            {note ? (
              <span className="text-[11px] text-base-content/50">{note}</span>
            ) : (
              <span />
            )}
            {historyNode && (
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                {historyNode}
              </div>
            )}
          </div>
        )
      )}

      {showPreview &&
        isPreviewCard &&
        (reading ? (
          <ReadPreview
            value={value}
            latest={latest}
            topic={topic}
            chip={chip}
            allowBlankShape={allowBlankShape}
            readPath={readPath}
            readsText={readsText}
            unit={unit}
            asCard={true}
          />
        ) : (
          acceptsChip && (
            <WritePreview
              value={value}
              chip={chip}
              range={range ?? null}
              previewValue={previewValue}
              position={position}
              onPosition={setPosition}
              asCard={true}
            />
          )
        ))}
    </div>
  );
}

/** The collapsed row's miniature: the payload one-lined, tokens highlighted with colors. */
export function PayloadSummary({
  value,
  empty = "not configured",
  max = 34,
  chips = true,
}: {
  value: string;
  empty?: string;
  max?: number;
  chips?: boolean;
}) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine === "")
    return <span className="text-base-content/50">{empty}</span>;

  const clipped =
    oneLine.length > max ? `${oneLine.slice(0, max - 2)}…` : oneLine;

  if (!chips) return <span className="font-mono">{clipped}</span>;

  const chunks = parseTemplateChunks(clipped);
  return (
    <span className="font-mono">
      {chunks.map((chunk, idx) => {
        if (!chunk.isToken) {
          return <span key={idx}>{chunk.text}</span>;
        }
        const name = (chunk.tokenName ?? "").toLowerCase();
        let badgeClass = "badge-primary";
        if (name === "topic") badgeClass = "badge-accent";
        else if (name === "timestamp" || name === "now")
          badgeClass = "badge-neutral";
        else if (name.startsWith("value:")) badgeClass = "badge-secondary";

        return (
          <span
            key={idx}
            className={`badge badge-xs ${badgeClass} font-mono px-1 py-0.5 text-[10px] mx-0.5`}
          >
            {chunk.tokenName ?? TOKEN_LABEL}
          </span>
        );
      })}
    </span>
  );
}

function WritePreview({
  value,
  chip,
  range,
  previewValue,
  position,
  onPosition,
  asCard = false,
}: {
  value: string;
  chip: boolean;
  range: NumericRange | null;
  previewValue?: string;
  position: number | null;
  onPosition: (next: number) => void;
  asCard?: boolean;
}) {
  if (asCard) {
    if (!chip) {
      return (
        <PreviewBox
          problem={
            value.trim() === ""
              ? "Nothing to send yet."
              : `No ${TOKEN_LABEL} token in message.`
          }
        />
      );
    }

    if (range) {
      const midpoint =
        range.min +
        Math.round((range.max - range.min) / 2 / range.step) * range.step;
      const at = position ?? midpoint;

      return (
        <PreviewBox note="Move the handle.">
          <div className="flex flex-col gap-2 min-w-0">
            <input
              type="range"
              aria-label="Preview position"
              className="range range-primary range-xs w-full"
              min={range.min}
              max={range.max}
              step={range.step}
              value={at}
              onChange={(e) => onPosition(Number(e.target.value))}
            />
            <PreviewLine label="Sends" bytes={renderPayload(value, at)} />
          </div>
        </PreviewBox>
      );
    }

    return (
      <PreviewBox>
        <PreviewLine
          label="Sends"
          bytes={renderPayload(value, previewValue ?? "")}
        />
      </PreviewBox>
    );
  }

  if (!chip) return null;

  if (range) {
    const midpoint =
      range.min +
      Math.round((range.max - range.min) / 2 / range.step) * range.step;
    const at = position ?? midpoint;

    return (
      <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-2 flex flex-col gap-1.5 min-w-0">
        <input
          type="range"
          aria-label="Preview position"
          className="range range-primary range-xs w-full"
          min={range.min}
          max={range.max}
          step={range.step}
          value={at}
          onChange={(e) => onPosition(Number(e.target.value))}
        />
        <PreviewLine label="Sends" bytes={renderPayload(value, at)} />
      </div>
    );
  }

  return (
    <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 min-w-0">
      <PreviewLine
        label="Sends"
        bytes={renderPayload(value, previewValue ?? "")}
      />
    </div>
  );
}

function ReadPreview({
  value,
  latest,
  topic,
  chip,
  allowBlankShape,
  readPath,
  readsText,
  unit,
  asCard = false,
}: {
  value: string;
  latest: RecentMessage | null;
  topic: string;
  chip: boolean;
  allowBlankShape: boolean;
  readPath?: string;
  readsText?: boolean;
  unit?: string;
  asCard?: boolean;
}) {
  const blank = value.trim() === "";

  if (asCard) {
    if (!latest) {
      return (
        <PreviewBox
          problem={
            topic.trim() === "" ? "No topic yet." : "Waiting for messages…"
          }
        />
      );
    }

    if ((blank && !allowBlankShape) || (!blank && !chip)) {
      return <PreviewBox problem={`Click ${TOKEN_LABEL} to mark value`} />;
    }

    const read = readShape(value, latest.payload, readPath);

    if (!read.found) {
      return (
        <PreviewBox>
          <PreviewLine label="Latest" bytes={latest.payload} />
          <span className="text-[11px] leading-relaxed text-warning">
            Pattern mismatch with latest message
          </span>
        </PreviewBox>
      );
    }

    return (
      <PreviewBox>
        <PreviewLine label="Latest" bytes={latest.payload} />
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="shrink-0 w-12 text-[9px] font-semibold uppercase tracking-wider text-base-content/50">
            Reads
          </span>
          <span className="flex-1 min-w-0 font-mono font-semibold text-xs truncate text-success">
            {readsText ? read.text : String(read.value)}
            {unit ? ` ${unit}` : ""}
          </span>
        </div>
      </PreviewBox>
    );
  }

  if (!latest) {
    if (topic.trim() === "") return null;
    return (
      <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 text-[11px] text-base-content/40 italic flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-base-content/30 shrink-0" />
        <span>Waiting for messages…</span>
      </div>
    );
  }

  if ((blank && !allowBlankShape) || (!blank && !chip)) {
    return (
      <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 text-[11px] text-base-content/40">
        Click {TOKEN_LABEL} to mark value
      </div>
    );
  }

  const read = readShape(value, latest.payload, readPath);

  if (!read.found) {
    return (
      <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 flex flex-col gap-1 min-w-0">
        <PreviewLine label="Latest" bytes={latest.payload} />
        <span className="text-[11px] leading-relaxed text-warning">
          Pattern mismatch with latest message
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 flex flex-col gap-1 min-w-0">
      <PreviewLine label="Latest" bytes={latest.payload} />
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="shrink-0 w-12 text-[9px] font-semibold uppercase tracking-wider text-base-content/50">
          Reads
        </span>
        <span className="flex-1 min-w-0 font-mono font-semibold text-xs truncate text-success">
          {readsText ? read.text : String(read.value)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
}

/** One labelled row of bytes inside a preview. */
export function PreviewLine({
  label,
  bytes,
}: {
  label: string;
  bytes: string;
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="shrink-0 w-12 pt-0.5 text-[9px] font-semibold uppercase tracking-wider text-base-content/50">
        {label}
      </span>
      <span className="flex-1 min-w-0 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {bytes}
      </span>
    </div>
  );
}

/**
 * The first number a payload actually carries, reported with where it sits.
 */
function firstNumber(payload: string): { text: string; start: number } | null {
  const plain = /^-?\d+(?:\.\d+)?$/;

  for (const { text, start } of findLiterals(payload, Infinity)) {
    if (plain.test(text)) return { text, start };

    const quoted = text.startsWith('"') && text.endsWith('"');
    const inner = quoted ? text.slice(1, -1) : null;
    if (inner !== null && plain.test(inner)) {
      return { text: inner, start: start + 1 };
    }
  }

  return null;
}

function markFirstNumber(payload: string, mark: boolean): string {
  const found = mark ? firstNumber(payload) : null;
  if (found === null) return payload;

  return (
    payload.slice(0, found.start) +
    VALUE_TOKEN +
    payload.slice(found.start + found.text.length)
  );
}
