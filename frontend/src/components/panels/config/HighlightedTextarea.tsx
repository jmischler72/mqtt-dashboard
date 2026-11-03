import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type TextareaHTMLAttributes,
} from "react";
import { RiCloseLine } from "react-icons/ri";
import { parseTemplateChunks, type ParsedChunk } from "../payloadShape";

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
  onRemoveToken?: (chunk: ParsedChunk, index: number) => void;
}

const HighlightedTextarea = forwardRef<
  HighlightedTextareaHandle,
  HighlightedTextareaProps
>(function HighlightedTextarea(
  {
    value,
    onChange,
    onSelectionChange,
    onRemoveToken,
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
  let tokenCount = 0;

  return (
    <div className={`relative min-h-[2.5rem] overflow-hidden ${className}`}>
      {/* Native textarea underneath */}
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

      {/* Syntax-highlighted overlay */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 m-0 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all pointer-events-none select-none overflow-hidden text-base-content z-10"
      >
        {value ? (
          <>
            {chunks.map((chunk, idx) => {
              if (!chunk.isToken) {
                return <span key={idx}>{chunk.text}</span>;
              }
              const tokenIdx = tokenCount++;
              const name = (chunk.tokenName ?? "").toLowerCase();
              let colorClass = "text-primary bg-primary/20";
              if (name === "topic") {
                colorClass = "text-accent bg-accent/20";
              } else if (name === "timestamp" || name === "now") {
                colorClass = "text-info bg-info/20";
              } else if (name.startsWith("value:") || name === "value") {
                colorClass = "text-primary bg-primary/20";
              }

              return (
                <span
                  key={idx}
                  data-value-token={onRemoveToken ? "" : undefined}
                  className={`group/token relative inline-block rounded-sm font-semibold px-0.5 ${colorClass}`}
                >
                  <span>{chunk.text}</span>
                  {onRemoveToken && (
                    <button
                      type="button"
                      data-remove-token
                      aria-label={`Remove ${chunk.text}`}
                      title={`Remove ${chunk.text}`}
                      tabIndex={-1}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveToken(chunk, tokenIdx);
                      }}
                      className="absolute -top-1.5 -right-1 w-3.5 h-3.5 rounded-full bg-base-100 border border-base-content/20 text-base-content/60 hover:text-error hover:border-error hover:bg-base-200 pointer-events-auto cursor-pointer inline-flex items-center justify-center transition-colors shadow-xs z-20"
                    >
                      <RiCloseLine className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              );
            })}
            {value.endsWith("\n") && " "}
          </>
        ) : null}
      </div>
    </div>
  );
});

export default HighlightedTextarea;
