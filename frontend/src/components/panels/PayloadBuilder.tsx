import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  RiErrorWarningLine as WarningIcon,
  RiEyeLine as PreviewIcon,
} from "react-icons/ri";
import { usePayloadSample } from "../../hooks/usePayloadSample";
import {
  paintTemplate,
  readSelectionOffsets,
  readTemplate,
  setCaret,
} from "./tokenEditor";
import {
  TOKEN_LABEL,
  VALUE_TOKEN,
  clearToken,
  findLiterals,
  hasToken,
  markLiteral,
  payloadIssue,
  placeToken,
  readValue,
  renderPayload,
} from "./payloadShape";

/** The payload box, dressed as the textarea it used to be. */
const editorClass =
  "textarea textarea-bordered w-full font-mono text-xs leading-relaxed " +
  "break-all whitespace-pre-wrap cursor-text";

/** One thing the panel can publish, shown as a preview row. */
export interface PayloadPreview {
  /** Row label — "On", "Off", "At 72", "07:00", "Sends". */
  key: string;
  /** Value substituted for the token; empty for panels with no runtime value. */
  value: string;
}

interface Props {
  /** The literal payload, with at most one token in it. */
  template: string;
  onTemplateChange: (template: string) => void;
  previews: PayloadPreview[];
  /**
   * False for panels with no runtime value (button, cron): a token there would
   * publish an empty hole, so it is flagged rather than offered.
   */
  acceptsToken?: boolean;
  brokerId: string;
  /** Topic sampled for the "messages your device sent" list. */
  topic: string;
  /**
   * "write" describes the payload to publish; "read" describes the shape of
   * incoming messages, where the token marks the value to pull out instead of
   * the value to drop in.
   */
  mode?: "write" | "read";
  /**
   * One line telling the user what the preview block is showing them, e.g.
   * "Move the handle to see what the slider publishes at that position."
   * Defaults to a description of the panel's own kind of publish.
   */
  previewNote?: string;
  /** Panel-specific controls (toggle's On/Off, slider's drag preview). */
  children?: ReactNode;
}

/**
 * The payload editor: the box holds the bytes that get published, verbatim, and
 * the single token marks the one spot the panel's own value drops into.
 *
 * There are no formats or modes to choose between — a device that wants
 * `{"brightness":128}` is configured by typing that and marking the 128. The
 * token's position is also where the value is read back from, so the shape is
 * described once for both directions.
 */
export default function PayloadBuilder({
  template,
  onTemplateChange,
  previews,
  acceptsToken = true,
  brokerId,
  topic,
  mode = "write",
  previewNote,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [samplesOpen, setSamplesOpen] = useState(false);
  // The constant a marked value held, handed back when the token moves on
  const [previous, setPrevious] = useState<string | null>(null);
  const [usedSample, setUsedSample] = useState<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // What the box currently shows. Repainting on every keystroke would drop the
  // caret, so the DOM is only rewritten when the template changed elsewhere —
  // a sample being used, or the token being moved by a chip below.
  const painted = useRef<string | null>(null);

  /**
   * Drop the chip where the user is pointing: at the caret, or over whatever
   * they have selected. This is what makes the token placeable anywhere —
   * inside a JSON value, in the middle of a word, in a format nothing here can
   * parse — rather than only onto values the editor managed to recognise.
   */
  const dropToken = () => {
    const host = editorRef.current;
    if (!host) return;

    // No caret in the box yet: the end of the payload is the honest guess
    const at = readSelectionOffsets(host) ?? {
      start: template.length,
      end: template.length,
    };

    // Whatever this drop covers is what a later move hands back: the text the
    // user actually replaced. Handing back the panel's demo value instead is
    // what used to silt the payload up with copies of it on repeated taps.
    const covered = template.slice(at.start, at.end);
    const placed = placeToken(template, at.start, at.end, previous ?? "");
    setPrevious(covered || null);

    paintTemplate(host, placed.template);
    painted.current = placed.template;
    host.focus();
    setCaret(host, placed.caret);

    // Dropping the chip where it already is changes nothing but the caret
    if (placed.template !== template) onTemplateChange(placed.template);
  };

  const handleInput = () => {
    const host = editorRef.current;
    if (!host) return;
    const next = readTemplate(host);
    painted.current = next;
    onTemplateChange(next);
  };

  const {
    recent,
    loading,
    payload: latest,
  } = usePayloadSample(brokerId, topic);
  const reading = mode === "read";

  useEffect(() => {
    const host = editorRef.current;
    if (!host) {
      // Closed: the next open starts from a fresh, unpainted box
      painted.current = null;
      return;
    }
    if (painted.current === template) return;
    paintTemplate(host, template);
    painted.current = template;
  }, [template, open]);

  const tokenPresent = hasToken(template);
  const literals = acceptsToken ? findLiterals(template) : [];
  // The spot the chip leaves gets back exactly what the chip covered, and
  // nothing if it covered nothing. The panel's demo value is for the preview
  // only — dropping it into the payload writes bytes the user never typed.
  const restore = previous ?? "";

  const rendered = previews.map((p) => ({
    ...p,
    bytes: renderPayload(template, p.value),
  }));

  // Two states show both sets of real bytes, since the difference between them
  // is the point. A single state shows the payload as written, mark included —
  // substituting the demo value would read as if that value were the payload.
  const summary = (
    reading || tokenPresent
      ? rendered.length > 1
        ? `${rendered[0].bytes}  /  ${rendered[1].bytes}`
        : template
      : (rendered[0]?.bytes ?? template)
  )
    .split("\n")
    .join(" ")
    .replace(/\s+/g, " ");

  // A payload with its token missing — or one in a panel that has no value to
  // put there — is a broken panel, so it is called out on the collapsed row the
  // same way an unset topic is, by the same check that holds Save shut.
  const issue = payloadIssue({ template, acceptsToken, mode });
  const misconfigured = issue !== null;

  const defaultNote = reading
    ? "What the panel pulls out of the latest message on this topic."
    : !acceptsToken
      ? "The exact bytes published every time this panel fires."
      : previews.length > 1
        ? "The exact bytes published in each state."
        : "The exact bytes published, with the panel's value dropped in.";

  const handleMark = (index: number) => {
    const result = markLiteral(template, literals[index], restore);
    setPrevious(result.previous);
    onTemplateChange(result.template);
  };

  return (
    <fieldset className="fieldset p-0 border-0 min-w-0 grid-cols-[minmax(0,1fr)]">
      {/* Collapsed row — a setting with a value, sitting with Label and Topic */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium text-base-content/80 w-14 shrink-0">
          {reading ? "Reads" : "Payload"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`flex-1 min-w-0 flex items-center gap-2 px-2.5 h-8 rounded-lg border bg-base-200/40 text-left cursor-pointer ${
            open
              ? "border-primary"
              : misconfigured
                ? "border-warning"
                : "border-base-300"
          }`}
        >
          <span className="font-mono text-xs truncate min-w-0">
            {summary
              ? // The same chip the editor shows, so the folded row and the
                // open one describe the payload the same way
                summary.split(VALUE_TOKEN).map((chunk, index) => (
                  <span key={index}>
                    {index > 0 && (
                      <span className="mx-0.5 px-1.5 rounded-full border border-primary bg-primary/15 text-primary">
                        {TOKEN_LABEL}
                      </span>
                    )}
                    {chunk}
                  </span>
                ))
              : "not configured"}
          </span>
          <span className="ml-auto shrink-0 text-[11px] font-medium text-primary">
            {open ? "Close ▴" : "Edit ▾"}
          </span>
        </button>
      </div>

      {/* Same alert the topic field raises when it is left unusable. Kept
          visible while the editor is open too, since it is also the reason the
          modal's Save button is off. */}
      {misconfigured && (
        <div
          role="alert"
          className="alert alert-warning py-1.5 px-3 text-xs mt-2 font-medium flex items-center gap-2"
        >
          <WarningIcon className="text-sm shrink-0" />
          <span>{issue}</span>
        </div>
      )}

      {open && (
        <div className="mt-2 pl-3 border-l-2 border-primary flex flex-col gap-2.5 min-w-0">
          {/* Start from something the device really sent, rather than typing
              the shape from memory. Collapsed by default: it is an offer, not
              a step. */}
          {recent.length > 0 && (
            <div
              className={`rounded-lg border bg-base-200/40 overflow-hidden ${
                samplesOpen ? "border-base-content/20" : "border-base-300"
              }`}
            >
              <button
                type="button"
                onClick={() => setSamplesOpen(!samplesOpen)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer"
              >
                <span
                  className={`shrink-0 w-3.5 text-[10px] text-base-content/60 transition-transform ${
                    samplesOpen ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
                <span className="text-[11.5px] font-medium">
                  Start from a message this device sent
                </span>
                <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 h-5 px-2 rounded-full bg-base-100 border border-base-300 font-mono text-[10.5px] text-base-content/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  {recent.length}
                </span>
              </button>

              {samplesOpen && (
                <div className="border-t border-base-300">
                  {recent.map((message, index) => {
                    const inUse = index === usedSample;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          onTemplateChange(message.payload);
                          setPrevious(null);
                          setUsedSample(index);
                        }}
                        className={`w-full min-w-0 flex items-start gap-2.5 pl-3 pr-2.5 py-2 border-b border-base-300 text-left cursor-pointer ${
                          inUse ? "bg-primary/10" : ""
                        }`}
                      >
                        <span className="shrink-0 w-9 pt-px text-[10.5px] font-medium text-base-content/40">
                          {message.ago}
                        </span>
                        <span
                          className={`flex-1 min-w-0 font-mono text-[11.5px] leading-relaxed break-all ${
                            inUse ? "" : "text-base-content/80"
                          }`}
                        >
                          {message.payload}
                        </span>
                        <span
                          className={`shrink-0 pt-px text-[10.5px] font-medium ${
                            inUse ? "text-primary/70" : "text-primary"
                          }`}
                        >
                          {inUse ? "in use" : "use"}
                        </span>
                      </button>
                    );
                  })}
                  <div className="pl-3 pr-2.5 pt-1.5 pb-2 text-[11px] text-base-content/50">
                    Replaces the box above. You can edit it afterwards.
                  </div>
                </div>
              )}
            </div>
          )}

          {loading && recent.length === 0 && (
            <span className="text-[11px] text-base-content/40">
              Looking for messages on this topic…
            </span>
          )}

          {/* The payload itself, sent verbatim. A contenteditable rather than
              a textarea, so the token can be a chip that says what it is: the
              chip is atomic, so it cannot be half-deleted or typed inside, and
              everything around it is ordinary text editing. */}
          <div
            ref={editorRef}
            className={editorClass}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={reading ? "Message shape" : "Payload"}
            spellCheck={false}
            onInput={handleInput}
            onPaste={(e) => {
              // Paste plain text: clipboard HTML would drag styling, and worse,
              // markup that reads back as payload it never contained.
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              document.execCommand("insertText", false, text);
            }}
          />

          {/* Put the token where it belongs: anywhere the user points, or onto
              a value the editor recognised */}
          {(literals.length > 0 || tokenPresent || acceptsToken) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-base-content/60">
                {!acceptsToken
                  ? `This panel publishes a fixed message — remove ${TOKEN_LABEL} to send it.`
                  : tokenPresent
                    ? `Put the caret where ${TOKEN_LABEL} should go instead, or select text to replace, then move it.`
                    : reading
                      ? `Put ${TOKEN_LABEL} where the value sits — select text to replace it, or tap one of the values below.`
                      : `Put ${TOKEN_LABEL} where the panel's value goes — select text to replace it, or tap one of the values below.`}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {acceptsToken && (
                  <button
                    type="button"
                    // mousedown, not click: the default would move focus out of
                    // the editor and take the selection being aimed at with it
                    onMouseDown={(e) => {
                      e.preventDefault();
                      dropToken();
                    }}
                    className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full border border-dashed border-primary/60 text-primary font-mono text-[11px] cursor-pointer hover:bg-primary/10"
                  >
                    <span aria-hidden="true">{tokenPresent ? "↦" : "+"}</span>
                    {tokenPresent ? `move ${TOKEN_LABEL}` : TOKEN_LABEL}
                  </button>
                )}
                {tokenPresent && (
                  <button
                    type="button"
                    onClick={() => {
                      onTemplateChange(clearToken(template, restore));
                      setPrevious(null);
                    }}
                    className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border border-primary bg-primary/15 text-primary font-mono text-[11px] cursor-pointer"
                  >
                    {TOKEN_LABEL} ✕
                  </button>
                )}
                {literals.map((literal, index) => (
                  <button
                    key={`${literal.start}-${literal.text}`}
                    type="button"
                    onClick={() => handleMark(index)}
                    className="inline-flex items-center h-6 px-2.5 rounded-full border border-base-300 bg-base-200/40 font-mono text-[11px] cursor-pointer hover:border-primary"
                  >
                    {literal.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Exactly what goes on the wire, in a section of its own so it is
              not mistaken for another thing to fill in. The panel's own control
              lives here too, so working it and reading the bytes it produces is
              one place rather than a demo above and its result below. */}
          <div className="rounded-lg border border-base-300 bg-base-200/40 p-2.5 flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-1.5">
              <PreviewIcon className="text-base-content/50 text-xs shrink-0" />
              <span className="text-[11px] font-medium text-base-content/70">
                Preview
              </span>
            </div>

            <p className="text-[11px] text-base-content/60 leading-normal">
              {previewNote ?? defaultNote}
            </p>

            {children}

            {reading && latest && (
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-[11px] text-base-content/60 w-14 shrink-0 pt-0.5">
                  Latest
                </span>
                <span className="font-mono text-xs break-all min-w-0">
                  {String(readValue(template, latest).value)}
                </span>
              </div>
            )}

            {!reading &&
              rendered.map((preview) => (
                <div
                  key={preview.key}
                  className="flex items-start gap-2 min-w-0"
                >
                  {/* One-state panels label the line from the control above it;
                      a blank key means the control has already said it. */}
                  {preview.key && (
                    <span className="text-[11px] text-base-content/60 w-14 shrink-0 pt-0.5">
                      {preview.key}
                    </span>
                  )}
                  <span className="font-mono text-xs break-all min-w-0">
                    {preview.bytes}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}
