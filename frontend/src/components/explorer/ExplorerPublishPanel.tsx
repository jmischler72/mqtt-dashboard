import { useState } from "react";
import {
  RiErrorWarningLine as WarningIcon,
  RiCloseLine as CloseIcon,
} from "react-icons/ri";
import InputPanel from "../panels/InputPanel";
import { PublishOptionsCard } from "../panels/config";

interface Props {
  brokerId: string;
  selectedTopic: string;
}

export default function ExplorerPublishPanel({
  brokerId,
  selectedTopic,
}: Props) {
  const [qos, setQos] = useState(0);
  const [retain, setRetain] = useState(false);
  const [dismissedTopic, setDismissedTopic] = useState<string | null>(null);

  const isWildcard = selectedTopic.includes("+") || selectedTopic.includes("#");
  const isDismissed = dismissedTopic === selectedTopic;

  if (isWildcard) {
    if (isDismissed) return null;
    return (
      <div className="border border-base-300 bg-base-200/40 rounded-xl p-3 text-xs flex flex-col gap-1 relative">
        <div className="flex items-center justify-between font-semibold text-base-content">
          <div className="flex items-center gap-1.5">
            <WarningIcon className="text-warning text-sm shrink-0" />
            <span>Cannot publish to wildcard topic</span>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-ghost btn-square text-base-content/60 hover:text-base-content shrink-0"
            title="Dismiss warning"
            onClick={() => setDismissedTopic(selectedTopic)}
          >
            <CloseIcon className="text-sm" />
          </button>
        </div>
        <p className="text-[11px] text-base-content/60 leading-normal pr-4">
          Topics with wildcards (
          <code className="font-mono text-warning">+</code> or{" "}
          <code className="font-mono text-warning">#</code>) cannot receive
          published messages. Select a specific sub-topic to publish.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <InputPanel
        brokerId={brokerId}
        config={{ qos, retain }}
        overrideTopic={selectedTopic}
        overrideBrokerId={brokerId}
      />
      <PublishOptionsCard
        qos={qos}
        onQosChange={setQos}
        retain={retain}
        onRetainChange={setRetain}
      />
    </div>
  );
}
