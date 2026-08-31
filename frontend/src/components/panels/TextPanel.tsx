import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { MdNotes } from "react-icons/md";
import {
  ConfigCard,
  ConfigGroup,
  DisclosureCard,
  PanelConfigModal,
} from "./config";

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

  return (
    <PanelConfigModal
      icon={MdNotes}
      title="Text Configuration"
      onCancel={onClose}
      onSave={() => onSave({ markdown }, "")}
    >
      {/* Nothing here touches a broker, so Appearance is the only group. */}
      <ConfigGroup heading="Appearance">
        <ConfigCard title="Markdown">
          <textarea
            className="w-full rounded-lg border border-base-300 dark:border-base-100 bg-base-300 px-2.5 py-2 font-mono text-xs leading-relaxed resize-y"
            aria-label="Markdown"
            rows={12}
            spellCheck={false}
            placeholder="# Hello&#10;&#10;Write **Markdown** here…"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
          />
          <button
            type="button"
            className="self-start inline-flex items-center h-6 px-2.5 rounded-full border border-base-300 dark:border-base-100 bg-base-100 text-[11px] font-medium text-base-content/70 cursor-pointer hover:border-primary"
            onClick={() => setMarkdown(TEMPLATE_MARKDOWN)}
          >
            start from a template
          </button>
        </ConfigCard>

        <DisclosureCard
          title="Preview"
          summary={`${markdown.trim() ? markdown.trim().split(/\s+/).length : 0} words`}
        >
          <div className="rounded-lg border border-base-300 dark:border-base-100 bg-base-100 p-3 min-w-0 overflow-x-auto">
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </div>
          </div>
        </DisclosureCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

interface TextPanelProps {
  config: TextConfig;
}

export default function TextPanel({ config }: TextPanelProps) {
  return (
    <div className="prose max-w-none prose-base h-full overflow-auto p-4">
      <ReactMarkdown>{config.markdown ?? ""}</ReactMarkdown>
    </div>
  );
}
