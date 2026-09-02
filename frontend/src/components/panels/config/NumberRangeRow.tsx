export interface NumberField {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  invalid?: boolean;
}

/**
 * A trio or pair of numbers that belong to one idea — a range, a scale — as one
 * row of equal-width fields under their own micro-captions, rather than three
 * full-width rows pretending to be unrelated settings.
 */
export default function NumberRangeRow({ fields }: { fields: NumberField[] }) {
  return (
    <div className="flex items-end gap-2 min-w-0">
      {fields.map((field) => (
        <label key={field.label} className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-[10.5px] text-base-content/70">
            {field.label}
          </span>
          <input
            className={`input input-bordered w-full h-[30px] min-h-[30px] font-mono text-xs ${
              field.invalid ? "input-warning" : ""
            }`}
            inputMode="decimal"
            placeholder={field.placeholder}
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
