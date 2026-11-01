import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type TextareaHTMLAttributes,
} from "react";
import { parseTemplateChunks } from "../payloadShape";

export interface HighlightedTextareaHandle {
  focus: () => void;
  getSelection: () => { start: number; end: number };
  setSelection: (start: number, end: number) => void;
}

export interface HighlightedTextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
}

const HighlightedTextarea = forwardRef<
  HighlightedTextareaHandle,
  HighlightedTextareaProps
>(function HighlightedTextarea(
  {
    value,
    onChange,
    onSelectionChange,
    placeholder,
    className = "",
    rows = 3,
    disabled,
    ...rest
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    getSelection: () => ({
      start: textareaRef.current?.selectionStart ?? value.length,
      end: textareaRef.current?.selectionEnd ?? value.length,
    }),
    setSelection: (start: number, end: number) => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start, end);
      }
    },
  }));

  const syncScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const reportSelection = useCallback(() => {
    if (textareaRef.current && onSelectionChange) {
      onSelectionChange({
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd,
      });
    }
  }, [onSelectionChange]);

  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  const chunks = parseTemplateChunks(value);

  return (
    <div className={`relative min-h-[2.5rem] overflow-hidden ${className}`}>
      {/* Syntax-highlighted backdrop */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 m-0 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all pointer-events-none select-none overflow-hidden text-base-content"
      >
        {value ? (
          <>
            {chunks.map((chunk, idx) => {
              if (!chunk.isToken) {
                return <span key={idx}>{chunk.text}</span>;
              }
              const name = (chunk.tokenName ?? "").toLowerCase();
              let colorClass = "text-primary bg-primary/20";
              if (name === "topic") {
                colorClass = "text-accent bg-accent/20";
              } else if (name === "timestamp" || name === "now") {
                colorClass = "text-info bg-info/20";
              } else if (name.startsWith("value:")) {
                colorClass = "text-secondary bg-secondary/20";
              }

              return (
                <span
                  key={idx}
                  className={`rounded-sm font-semibold px-0.5 ${colorClass}`}
                >
                  {chunk.text}
                </span>
              );
            })}
            {value.endsWith("\n") && " "}
          </>
        ) : null}
      </div>

      {/* Native textarea overlay */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onSelect={reportSelection}
        onKeyUp={reportSelection}
        onClick={reportSelection}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className={`relative block w-full m-0 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all bg-transparent caret-base-content border-0 outline-none resize-none overflow-auto placeholder:text-base-content/40 selection:bg-primary/30 ${
          value ? "text-transparent" : "text-base-content"
        }`}
        {...rest}
      />
    </div>
  );
});

export default HighlightedTextarea;
