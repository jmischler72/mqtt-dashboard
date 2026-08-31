import { hasToken } from "../payloadShape";

export interface ConfigRule {
  /**
   * Which control the message hangs under. Rules without one are still worth
   * saying in the footer, they just have no border to colour.
   */
  field?: string;
  /** True when this rule is being broken right now. */
  when: boolean;
  message: string;
}

export interface ConfigValidation {
  /** field → the first message broken for it, for borders and help lines. */
  fieldErrors: Record<string, string>;
  /** The single most important reason Save is off, or null. */
  blockerReason: string | null;
  saveDisabled: boolean;
}

/**
 * One rule table per modal, evaluated in the order it is written: the first
 * broken rule is what the footer says. The field borders and the footer line
 * therefore come from the same source and can never contradict each other.
 *
 * Marks show from the first frame rather than waiting on an edit: a modal that
 * opens with a dead Save has to point at the control responsible for it, and a
 * mark that only appears once the box has been typed in and cleared again reads
 * as a glitch.
 */
export function useConfigValidation(rules: ConfigRule[]): ConfigValidation {
  const broken = rules.filter((r) => r.when);
  const blockerReason = broken[0]?.message ?? null;

  const fieldErrors: Record<string, string> = {};
  for (const rule of broken) {
    if (rule.field && !(rule.field in fieldErrors)) {
      fieldErrors[rule.field] = rule.message;
    }
  }

  return { fieldErrors, blockerReason, saveDisabled: blockerReason !== null };
}

/* --------------------------------------------------------------------------
 * The rules every modal shares, so the same situation is worded identically
 * wherever it happens. A panel adds its own rules to these, never a reworded
 * copy of one.
 * ------------------------------------------------------------------------ */

export function brokerRules(brokerCount: number): ConfigRule[] {
  return [
    {
      when: brokerCount === 0,
      message: "Add a broker in Config to save.",
    },
  ];
}

export interface TopicRuleSpec {
  field?: string;
  topic: string;
  /** Read-only topics may carry `+` and `#`; a topic published to may not. */
  allowWildcards?: boolean;
  /** "A command topic", "A topic", "Read-back" — what the sentence is about. */
  subject?: string;
}

export function topicRules({
  field = "topic",
  topic,
  allowWildcards = false,
  subject = "A topic",
}: TopicRuleSpec): ConfigRule[] {
  const entries = topic
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const wild = entries.filter((t) => t.includes("+") || t.includes("#"));

  return [
    {
      field,
      when: entries.length === 0,
      message: `${subject} is needed before this can save.`,
    },
    {
      field,
      when: !allowWildcards && wild.length > 0,
      message: `Publishing to a wildcard topic isn't possible — remove ${wild[0] ?? "+ and #"}.`,
    },
  ];
}

export interface PayloadRuleSpec {
  field?: string;
  value: string;
  mode: "write" | "read";
  /**
   * False for a panel with no runtime value (button, cron): there is nothing
   * for a chip to stand in for, so one is never asked for. Bytes that happen to
   * contain the token's text are still fine — these panels publish the box
   * verbatim, so `{value}` in it is characters the device asked for.
   */
  acceptsChip?: boolean;
  /**
   * Whether an empty box is a problem. In read mode a blank shape means "the
   * whole payload", which is exactly right for a device that publishes its
   * value on its own — so a panel that can read that way says so here.
   */
  allowEmpty?: boolean;
  /** "the slider has", "a button has" — completes the empty-box sentence. */
  subject?: string;
}

export function payloadRules({
  field = "payload",
  value,
  mode,
  acceptsChip = true,
  allowEmpty = false,
  subject = "this panel has",
}: PayloadRuleSpec): ConfigRule[] {
  const chip = hasToken(value);

  if (mode === "read") {
    return [
      {
        field,
        // A blank box is only a problem when the panel cannot read the whole
        // payload; bytes with no chip in them mark nothing either way.
        when: allowEmpty ? value.trim() !== "" && !chip : !chip,
        message:
          "The read shape has no value chip, so nothing can be pulled out of it.",
      },
    ];
  }

  return [
    {
      field,
      when: !allowEmpty && value.trim() === "",
      message: `No message configured — ${subject} nothing to publish.`,
    },
    {
      field,
      when: acceptsChip && value.trim() !== "" && !chip,
      message:
        "Add the value chip to the message, or every publish sends the same bytes.",
    },
  ];
}

export interface RangeRuleSpec {
  field?: string;
  /** Raw strings, so a cleared box is "missing" rather than a silent zero. */
  low: string;
  high: string;
  step?: string;
  lowLabel?: string;
  highLabel?: string;
}

export function rangeRules({
  field = "range",
  low,
  high,
  step,
  lowLabel = "Low",
  highLabel = "High",
}: RangeRuleSpec): ConfigRule[] {
  const num = (raw: string) =>
    raw.trim() === "" || Number.isNaN(Number(raw)) ? null : Number(raw);

  const lowNum = num(low);
  const highNum = num(high);
  const stepNum = step === undefined ? 1 : num(step);

  return [
    {
      field,
      when: lowNum === null || highNum === null,
      message: `${lowLabel} and ${highLabel} are both required.`,
    },
    {
      field,
      when: lowNum !== null && highNum !== null && highNum <= lowNum,
      message: `${highLabel} must be greater than ${lowLabel}.`,
    },
    {
      field,
      when: step !== undefined && (stepNum === null || stepNum <= 0),
      message: "Step must be greater than 0.",
    },
  ];
}
