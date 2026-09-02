import { useEffect, useRef, useState } from "react";
import {
  usePayloadSample,
  type RecentMessage,
} from "../../../hooks/usePayloadSample";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  findLiterals,
  hasToken,
  keepOneToken,
  offsetAfterKeepOneToken,
  readShape,
  renderPayload,
} from "../payloadShape";
import MessageHistory from "./MessageHistory";
import {
  paintTemplate,
  readSelectionOffsets,
  readTemplate,
  setCaret,
} from "./tokenEditor";
import PreviewBox from "./PreviewBox";
import ValueChipControls from "./ValueChipControls";

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
   * drop in. One mark, both directions.
   */
  mode: "write" | "read";
  value: string;
  onChange: (next: string) => void;
  /** Sampled for the history list, and named in its empty state. */
  topic: string;
  brokerId: string;
  /**
   * Supplied when several boxes share one history disclosure — the toggle's On
   * and Off payloads are two boxes fed from the same list of real messages.
   */
  history?: PayloadHistory;
  /** False when the caller draws the shared history itself. */
  showHistory?: boolean;
  /**
   * False when the caller previews the bytes itself, e.g. the toggle, which
   * has two of them and would otherwise repeat one of the two right here.
   */
  showPreview?: boolean;
  /**
   * False for a panel with no runtime value (button, cron): the chip would
   * publish an empty hole, so it is never offered.
   */
  acceptsChip?: boolean;
  /** Read mode: an empty box means "the whole payload", not "unconfigured". */
  allowBlankShape?: boolean;
  /**
   * Read mode: the dot path stored before shapes existed, which the panel still
   * reads through when the shape marks nothing of its own. Passed so the
   * preview reads a message exactly the way the panel does.
   */
  readPath?: string;
  /**
   * Read mode: true for a panel that compares the marked characters rather than
   * reading a value out of them — the toggle, matching `ON` against its states.
   * Without it the preview would report `true` for a panel matching `ON`.
   */
  readsText?: boolean;
  placeholder?: string;
  /** Write mode: the live preview sweeps this range. */
  range?: NumericRange | null;
  /** Write mode without a range: the value the preview substitutes. */
  previewValue?: string;
  /** Appended to the read preview. Display only, never sent. */
  unit?: string;
  /**
   * The line under a chip-less box. Null drops it, for the toggle's second
   * payload — one card should say "sent verbatim" once, not twice.
   */
  note?: string | null;
}

/** The bytes box's own class list — monospace, wrapping, nothing clever. */
const boxClass =
  "w-full rounded-lg border border-base-300 dark:border-base-100 bg-base-300 " +
  "px-2.5 py-2 font-mono text-xs leading-relaxed break-all cursor-text " +
  "min-h-[2.25rem] max-h-40 overflow-auto whitespace-pre-wrap outline-none " +
  "focus:border-primary " +
  "empty:before:content-[attr(data-placeholder)] empty:before:text-base-content/40";

/**
 * The one payload editor, used by every panel that reads or writes a payload.
 *
 * The box holds the bytes verbatim — there is no format picker, no JSON
 * validation and no type wizard, because what a device expects on the wire is
 * the device's business. The single `{value}` chip is the only thing this
 * understands about the contents: where the panel's own value goes, or where it
 * is read back from.
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
  acceptsChip = true,
  allowBlankShape = false,
  readPath,
  readsText,
  placeholder,
  range,
  previewValue,
  unit,
  note = "Sent exactly as written.",
}: PayloadBuilderProps) {
  const [covered, setCovered] = useState("");
  const [usedIndex, setUsedIndex] = useState<number | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // What the box currently shows. Repainting on every keystroke would drop the
  // caret, so the DOM is only rewritten when the value changed elsewhere — a
  // message being taken, or the chip being placed by the controls below.
  const painted = useRef<string | null>(null);
  // Where the caret belongs after such a repaint, when the change knows.
  const pendingCaret = useRef<number | null>(null);

  // Only sampled when the caller has not already done it for a shared list
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

  useEffect(() => {
    const host = box.current;
    if (!host) return;
    if (painted.current === value) return;

    paintTemplate(host, value, acceptsChip);
    painted.current = value;

    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (caret !== null) {
      host.focus();
      setCaret(host, caret);
    }
  }, [value, acceptsChip]);

  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      {showHistory && (
        <MessageHistory
          topic={topic}
          messages={messages}
          loading={loading}
          actions={[
            { key: "use", label: "use this message", onUse: useMessage },
          ]}
          usedKey={usedIndex === null ? null : `${usedIndex}:use`}
        />
      )}

      {/* A contenteditable rather than a textarea, so the token can be the
          chip that says what it is rather than the literal characters
          "{value}". The chip is atomic — it cannot be typed inside or
          half-deleted — and everything around it is ordinary text editing. */}
      <div
        ref={box}
        className={boxClass}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={reading ? "Message shape" : "Message"}
        data-placeholder={placeholder}
        spellCheck={false}
        onInput={(e) => {
          const host = e.currentTarget;
          const raw = readTemplate(host);
          const next = acceptsChip ? keepOneToken(raw) : raw;

          if (next === raw) {
            painted.current = next;
          } else {
            // A second chip was spelled out and has been dropped. The box still
            // shows it, so leave `painted` on what is there and let the repaint
            // run; the caret moves back only past the removals that were
            // actually before it — a chip typed *ahead* of an existing one wins,
            // and it is the older one behind the caret that goes.
            painted.current = raw;
            const at = readSelectionOffsets(host)?.start ?? raw.length;
            pendingCaret.current = Math.min(
              next.length,
              offsetAfterKeepOneToken(raw, at),
            );
          }

          onChange(next);
          setUsedIndex(null);
        }}
        onPaste={(e) => {
          // Paste plain text: clipboard HTML would drag styling in, and worse,
          // markup that reads back as payload it never contained.
          e.preventDefault();
          document.execCommand(
            "insertText",
            false,
            e.clipboardData.getData("text/plain"),
          );
        }}
      />

      {acceptsChip ? (
        <ValueChipControls
          mode={mode}
          value={value}
          onChange={(next) => {
            // A chip action that changes nothing repaints nothing, so the caret
            // it asked for would sit in the ref and fire on some later,
            // unrelated repaint.
            if (next === value) pendingCaret.current = null;
            onChange(next);
          }}
          getSelection={() =>
            box.current ? readSelectionOffsets(box.current) : null
          }
          onCaret={(at) => {
            pendingCaret.current = at;
          }}
          covered={covered}
          onCoveredChange={setCovered}
        />
      ) : (
        note && <span className="text-[11px] text-base-content/50">{note}</span>
      )}

      {!showPreview ? null : reading ? (
        <ReadPreview
          value={value}
          latest={latest}
          topic={topic}
          chip={chip}
          allowBlankShape={allowBlankShape}
          readPath={readPath}
          readsText={readsText}
          unit={unit}
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
          />
        )
      )}
    </div>
  );
}

/** The collapsed row's miniature: the payload one-lined, chip drawn as a pill. */
export function PayloadSummary({
  value,
  empty = "not configured",
  max = 34,
  chips = true,
}: {
  value: string;
  empty?: string;
  max?: number;
  /** False where the token's characters are literal bytes, not a chip. */
  chips?: boolean;
}) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine === "")
    return <span className="text-base-content/50">{empty}</span>;

  const clipped =
    oneLine.length > max ? `${oneLine.slice(0, max - 2)}…` : oneLine;

  if (!chips) return <span className="font-mono">{clipped}</span>;

  return (
    <span className="font-mono">
      {clipped.split(VALUE_TOKEN).map((chunk, index) => (
        <span key={index}>
          {index > 0 && (
            <span className="mx-0.5 px-1.5 rounded-full bg-primary text-primary-content">
              {TOKEN_LABEL}
            </span>
          )}
          {chunk}
        </span>
      ))}
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
}: {
  value: string;
  chip: boolean;
  range: NumericRange | null;
  previewValue?: string;
  position: number | null;
  onPosition: (next: number) => void;
}) {
  if (!chip) {
    return (
      <PreviewBox
        problem={
          value.trim() === ""
            ? "Nothing to send yet."
            : `No ${TOKEN_LABEL} chip — every publish sends these exact bytes.`
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

function ReadPreview({
  value,
  latest,
  topic,
  chip,
  allowBlankShape,
  readPath,
  readsText,
  unit,
}: {
  value: string;
  latest: RecentMessage | null;
  topic: string;
  chip: boolean;
  allowBlankShape: boolean;
  readPath?: string;
  readsText?: boolean;
  unit?: string;
}) {
  const blank = value.trim() === "";

  // "No sample yet" and "the shape does not fit" are different problems and are
  // never collapsed into one another — nothing published yet is not a mistake.
  if (!latest) {
    return (
      <PreviewBox
        problem={
          topic.trim() === ""
            ? "No topic yet."
            : "Nothing heard on this topic yet."
        }
      />
    );
  }

  if (blank && !allowBlankShape) {
    return <PreviewBox problem="Nothing marked to read." />;
  }

  if (!blank && !chip) {
    return <PreviewBox problem="Nothing marked to read." />;
  }

  // Read it exactly the way the panel will, so the two can never disagree:
  // through the same shape, and — for a panel that matches text — reported as
  // the characters it matches rather than as the value they parse into.
  const read = readShape(value, latest.payload, readPath);

  if (!read.found) {
    return (
      <PreviewBox>
        <PreviewLine label="Latest" bytes={latest.payload} />
        <span className="text-[11px] leading-relaxed text-warning">
          This shape doesn't match the message above. Adjust it, or start from a
          message and mark the value.
        </span>
      </PreviewBox>
    );
  }

  return (
    <PreviewBox note="What the panel reads.">
      <PreviewLine label="Latest" bytes={latest.payload} />
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="shrink-0 w-[46px] text-[9px] font-semibold uppercase tracking-[0.09em] text-base-content/50">
          Reads
        </span>
        <span className="flex-1 min-w-0 font-mono font-semibold text-[15px] truncate text-success">
          {readsText ? read.text : String(read.value)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </PreviewBox>
  );
}

/** One labelled row of bytes inside a `PreviewBox`. */
export function PreviewLine({
  label,
  bytes,
}: {
  label: string;
  bytes: string;
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="shrink-0 w-[46px] pt-0.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-base-content/50">
        {label}
      </span>
      <span className="flex-1 min-w-0 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {bytes}
      </span>
    </div>
  );
}

/**
 * The first number a payload actually *carries* — what picking a message turns
 * into the chip — reported with where it sits, so the mark lands on the digits
 * that were found rather than on the first place those characters occur.
 *
 * `findLiterals` already knows a value from the key naming it, quoted or not,
 * and never looks inside a quoted run — so `{"ts":"2026-08-31T14:32:07Z",
 * "temp":21.5}` marks 21.5 rather than the year, and `{ch1:5}` marks 5 rather
 * than half a field name. Keeping that judgement in one place is the point: a
 * second opinion here is how the timestamp case survived the first fix.
 */
function firstNumber(payload: string): { text: string; start: number } | null {
  const plain = /^-?\d+(?:\.\d+)?$/;

  // No cap: the row of chips shows four, but the number worth marking can sit
  // behind any amount of text the device sends alongside it.
  for (const { text, start } of findLiterals(payload, Infinity)) {
    if (plain.test(text)) return { text, start };

    // A number the device quotes is still the reading. The chip goes inside the
    // quotes, so the shape it builds keeps them.
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
