import { useRef, useState, type ReactNode } from "react";
import {
  RiCloseLine,
  RiEyeLine,
  RiMessage3Line,
  RiSendPlaneLine,
} from "react-icons/ri";
import {
  usePayloadSample,
  type RecentMessage,
} from "../../../hooks/usePayloadSample";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  countTokens,
  detectPayloadMode,
  findLiterals,
  hasAnyToken,
  hasToken,
  isBareToken,
  parseTemplateChunks,
  previewPayload,
  readShape,
  type ParsedChunk,
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
  previewCard = true,
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
  const isPreviewCard = previewCard;
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

  const handleRemoveToken = (chunk: ParsedChunk) => {
    if (isBareToken(value) || value.trim() === chunk.text) {
      onChange("");
      setCovered("");
      setPosition(null);
      setUsedIndex(null);
      textareaRef.current?.focus();
      return;
    }

    const restore = covered || "";
    const next = value.slice(0, chunk.start) + restore + value.slice(chunk.end);

    onChange(next);
    setCovered("");
    setPosition(null);
    setUsedIndex(null);

    setTimeout(() => {
      const at = chunk.start + restore.length;
      textareaRef.current?.setSelection(at, at);
    }, 0);
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
            onRemoveToken={acceptsChip ? handleRemoveToken : undefined}
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
              topic={topic}
              availableTokens={availableTokens}
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
          latestPayload={latest?.payload}
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
              topic={topic}
              availableTokens={availableTokens}
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
  topic,
  availableTokens,
}: {
  value: string;
  chip: boolean;
  range: NumericRange | null;
  previewValue?: string;
  position: number | null;
  onPosition: (next: number) => void;
  asCard?: boolean;
  topic?: string;
  availableTokens?: Array<{ name: string; token: string; label: string }>;
}) {
  const requiresSpecificValue = Boolean(range);
  const allowsOtherTokens = Boolean(
    availableTokens && !availableTokens.some((t) => t.name === "value"),
  );
  const hasTokenInTemplate = chip || hasAnyToken(value);
  const missingToken = requiresSpecificValue
    ? !chip
    : allowsOtherTokens
      ? false
      : !hasTokenInTemplate;

  const midpoint = range
    ? range.min +
      Math.round((range.max - range.min) / 2 / range.step) * range.step
    : 0;
  const at = position ?? midpoint;

  const renderedBytes = range
    ? previewPayload(value, at, topic, null, availableTokens)
    : previewPayload(value, previewValue, topic, null, availableTokens);

  if (asCard) {
    if (value.trim() === "") {
      return <PreviewBox problem="Payload required" />;
    }
    if (missingToken) {
      return <PreviewBox problem={`Missing ${TOKEN_LABEL} token`} />;
    }

    if (range) {
      return (
        <PreviewBox note="Adjust slider to test">
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
            <PreviewLine
              icon={<RiSendPlaneLine className="text-base shrink-0" />}
              tooltip="Sends"
              bytes={renderedBytes}
              badgeClass="bg-primary/10 border border-primary/25 text-primary"
            />
          </div>
        </PreviewBox>
      );
    }

    return (
      <PreviewBox>
        <PreviewLine
          icon={<RiSendPlaneLine className="text-base shrink-0" />}
          tooltip="Sends"
          bytes={renderedBytes}
          badgeClass="bg-primary/10 border border-primary/25 text-primary"
        />
      </PreviewBox>
    );
  }

  if (value.trim() === "" || missingToken) return null;

  if (range) {
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
        <PreviewLine
          icon={<RiSendPlaneLine className="text-base shrink-0" />}
          tooltip="Sends"
          bytes={renderedBytes}
          badgeClass="bg-primary/10 border border-primary/25 text-primary"
        />
      </div>
    );
  }

  return (
    <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 min-w-0">
      <PreviewLine
        icon={<RiSendPlaneLine className="text-base shrink-0" />}
        tooltip="Sends"
        bytes={renderedBytes}
        badgeClass="bg-primary/10 border border-primary/25 text-primary"
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
  const tokenCount = countTokens(value);

  if (tokenCount > 1) {
    return null;
  }

  if (asCard) {
    if (!latest) {
      return (
        <PreviewBox
          problem={
            topic.trim() === "" ? "Topic required" : "Waiting for messages…"
          }
        />
      );
    }

    if ((blank && !allowBlankShape) || (!blank && !chip)) {
      return <PreviewBox problem="Select or tap value to extract" />;
    }

    const read = readShape(value, latest.payload, readPath);

    if (!read.found) {
      return (
        <PreviewBox>
          <PreviewLine
            icon={<RiMessage3Line className="text-base shrink-0" />}
            tooltip="Latest message"
            bytes={latest.payload}
          />
          <span className="text-[11px] leading-relaxed text-warning">
            Pattern mismatch with latest message
          </span>
        </PreviewBox>
      );
    }

    const readDisplay = `${readsText ? read.text : String(read.value)}${unit ? ` ${unit}` : ""}`;

    return (
      <PreviewBox>
        <PreviewLine
          icon={<RiMessage3Line className="text-base shrink-0" />}
          tooltip="Latest message"
          bytes={latest.payload}
        />
        <PreviewLine
          icon={<RiEyeLine className="text-base shrink-0" />}
          tooltip="Reads"
          bytes={readDisplay}
          badgeClass="bg-success/15 border border-success/30 text-success"
          codeClass="bg-success/10 border border-success/25 text-success font-semibold"
        />
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
        Select or tap value to extract
      </div>
    );
  }

  const read = readShape(value, latest.payload, readPath);

  if (!read.found) {
    return (
      <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 flex flex-col gap-1 min-w-0">
        <PreviewLine
          icon={<RiMessage3Line className="text-base shrink-0" />}
          tooltip="Latest message"
          bytes={latest.payload}
        />
        <span className="text-[11px] leading-relaxed text-warning">
          Pattern mismatch with latest message
        </span>
      </div>
    );
  }

  const readDisplay = `${readsText ? read.text : String(read.value)}${unit ? ` ${unit}` : ""}`;

  return (
    <div className="border-t border-base-content/10 bg-base-200/50 px-2.5 py-1.5 flex flex-col gap-1 min-w-0">
      <PreviewLine
        icon={<RiMessage3Line className="text-base shrink-0" />}
        tooltip="Latest message"
        bytes={latest.payload}
      />
      <PreviewLine
        icon={<RiEyeLine className="text-base shrink-0" />}
        tooltip="Reads"
        bytes={readDisplay}
        badgeClass="bg-success/15 border border-success/30 text-success"
        codeClass="bg-success/10 border border-success/25 text-success font-semibold"
      />
    </div>
  );
}

/** One labelled row of bytes inside a preview. */
export function PreviewLine({
  label,
  icon,
  tooltip,
  bytes,
  badgeClass,
  codeClass,
}: {
  label?: ReactNode;
  icon?: ReactNode;
  tooltip?: string;
  bytes: string;
  badgeClass?: string;
  codeClass?: string;
}) {
  const badge = icon ? (
    <div
      className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
        badgeClass ??
        "bg-base-200 border border-base-300 dark:border-base-100/30 text-base-content"
      }`}
    >
      {icon}
    </div>
  ) : label ? (
    <span
      className={`min-w-6 px-1.5 h-6 rounded flex items-center justify-center shrink-0 text-[10px] font-semibold uppercase tracking-wider ${
        badgeClass ??
        "bg-base-200 border border-base-300 dark:border-base-100/30 text-base-content/70"
      }`}
    >
      {label}
    </span>
  ) : null;

  return (
    <div className="flex items-center gap-2 min-w-0">
      {badge ? (
        tooltip ? (
          <div
            className="tooltip tooltip-top shrink-0 flex items-center"
            data-tip={tooltip}
            title={tooltip}
          >
            {badge}
          </div>
        ) : (
          badge
        )
      ) : null}
      <code
        className={`flex-1 min-w-0 font-mono text-xs px-2.5 py-1 rounded border truncate select-all ${
          codeClass ??
          "bg-base-200/80 dark:bg-base-200/40 border-base-300 dark:border-base-100/30 text-base-content"
        }`}
        title={bytes}
      >
        {bytes}
      </code>
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
