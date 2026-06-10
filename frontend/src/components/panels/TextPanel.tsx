import { useState } from "react";
import ReactMarkdown from "react-markdown";

export interface TextConfig {
  markdown?: string;
  color?: string;
  fontSize?: "sm" | "base" | "lg" | "xl";
  align?: "left" | "center" | "right";
}

const FONT_SIZE_CLASS: Record<NonNullable<TextConfig["fontSize"]>, string> = {
  sm: "prose-sm",
  base: "prose-base",
  lg: "prose-lg",
  xl: "prose-xl",
};

const ALIGN_CLASS: Record<NonNullable<TextConfig["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const TEMPLATE: TextConfig = {
  markdown:
    "# Section Title\n\nDescribe this part of your dashboard here.\n\n- Point one\n- Point two\n\n> Tip: use **Markdown** to format text.",
  color: "#1f2937",
  fontSize: "base",
  align: "left",
};

interface ModalProps {
  config: TextConfig;
  onSave: (cfg: TextConfig, brokerId: string) => void;
  onClose: () => void;
}

export function TextConfigModal({ config, onSave, onClose }: ModalProps) {
  const [markdown, setMarkdown] = useState(config.markdown ?? "");
  const [color, setColor] = useState(config.color ?? "#1f2937");
  const [fontSize, setFontSize] = useState<NonNullable<TextConfig["fontSize"]>>(
    config.fontSize ?? "base",
  );
  const [align, setAlign] = useState<NonNullable<TextConfig["align"]>>(
    config.align ?? "left",
  );
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  const applyTemplate = () => {
    setMarkdown(TEMPLATE.markdown ?? "");
    setColor(TEMPLATE.color ?? "#1f2937");
    setFontSize(TEMPLATE.fontSize ?? "base");
    setAlign(TEMPLATE.align ?? "left");
  };

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] w-1/3 min-w-96 max-w-none overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Text Configuration</h3>
          <button className="btn btn-xs btn-outline" onClick={applyTemplate}>
            Start with a template
          </button>
        </div>

        <div role="tablist" className="tabs tabs-bordered mb-3">
          <button
            role="tab"
            className={`tab ${tab === "edit" ? "tab-active" : ""}`}
            onClick={() => setTab("edit")}
          >
            Edit
          </button>
          <button
            role="tab"
            className={`tab ${tab === "preview" ? "tab-active" : ""}`}
            onClick={() => setTab("preview")}
          >
            Preview
          </button>
        </div>

        {tab === "edit" ? (
          <textarea
            className="textarea textarea-bordered w-full font-mono text-sm"
            rows={12}
            placeholder="# Hello&#10;&#10;Write **Markdown** here…"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
          />
        ) : (
          <div className="border border-base-300 rounded-box p-3 min-h-48 overflow-auto">
            <TextRender
              config={{ markdown, color, fontSize, align }}
              fill={false}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-4 mt-3">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Color</legend>
            <input
              type="color"
              className="input input-bordered h-9 w-16 p-1"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Font size</legend>
            <select
              className="select select-bordered"
              value={fontSize}
              onChange={(e) =>
                setFontSize(e.target.value as NonNullable<TextConfig["fontSize"]>)
              }
            >
              <option value="sm">Small</option>
              <option value="base">Normal</option>
              <option value="lg">Large</option>
              <option value="xl">Extra large</option>
            </select>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Alignment</legend>
            <select
              className="select select-bordered"
              value={align}
              onChange={(e) =>
                setAlign(e.target.value as NonNullable<TextConfig["align"]>)
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </fieldset>
        </div>

        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ markdown, color, fontSize, align }, "")}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

function TextRender({ config, fill }: { config: TextConfig; fill: boolean }) {
  const fontSize = config.fontSize ?? "base";
  const align = config.align ?? "left";
  return (
    <div
      className={`prose max-w-none ${FONT_SIZE_CLASS[fontSize]} ${ALIGN_CLASS[align]} ${fill ? "h-full overflow-auto" : ""}`}
      style={{ color: config.color }}
    >
      <ReactMarkdown>{config.markdown ?? ""}</ReactMarkdown>
    </div>
  );
}

interface TextPanelProps {
  config: TextConfig;
}

export default function TextPanel({ config }: TextPanelProps) {
  if (!config.markdown) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
        Empty text panel — open settings to add content
      </div>
    );
  }
  return <TextRender config={config} fill />;
}
