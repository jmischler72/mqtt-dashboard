import { useState } from "react";
import ReactMarkdown from "react-markdown";

export interface TextConfig {
  markdown?: string;
}

const TEMPLATE_MARKDOWN =
  "# Section Title\n\nDescribe this part of your dashboard here.\n\n- Point one\n- Point two\n\n> Tip: use **Markdown** to format text.";

interface ModalProps {
  config: TextConfig;
  onSave: (cfg: TextConfig, brokerId: string) => void;
  onClose: () => void;
}

export function TextConfigModal({ config, onSave, onClose }: ModalProps) {
  const [markdown, setMarkdown] = useState(config.markdown ?? "");
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] w-1/3 min-w-96 max-w-none overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">Text Configuration</h3>
          <button
            className="btn btn-xs btn-outline"
            onClick={() => setMarkdown(TEMPLATE_MARKDOWN)}
          >
            Start with a template
          </button>
        </div>

        <div
          role="tablist"
          className="tabs tabs-boxed bg-base-200 mb-3 p-1 gap-1"
        >
          <button
            role="tab"
            className={`tab flex-1 ${tab === "edit" ? "tab-active bg-primary text-primary-content" : ""}`}
            onClick={() => setTab("edit")}
          >
            Edit
          </button>
          <button
            role="tab"
            className={`tab flex-1 ${tab === "preview" ? "tab-active bg-primary text-primary-content" : ""}`}
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
            <div className="prose max-w-none prose-base">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </div>
          </div>
        )}

        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ markdown }, "")}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
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
  return (
    <div className="prose max-w-none prose-base h-full overflow-auto p-4">
      <ReactMarkdown>{config.markdown}</ReactMarkdown>
    </div>
  );
}
