import { useState } from "react";
import {
  RiErrorWarningLine as WarningIcon,
  RiCloseLine as CloseIcon,
} from "react-icons/ri";
import InputPanel from "../panels/InputPanel";
import { PublishOptionsCard } from "../panels/config";

/**
 * Once someone has read why a wildcard topic cannot be published to, they know
 * it for every wildcard topic — so the dismissal is remembered across sessions
 * and topics rather than reappearing on each new `+`/`#` selection.
 */
const WILDCARD_NOTICE_KEY = "mqtt_wildcard_publish_notice_dismissed";

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
  const [noticeDismissed, setNoticeDismissed] = useState(
    () => localStorage.getItem(WILDCARD_NOTICE_KEY) === "true",
  );

  const isWildcard = selectedTopic.includes("+") || selectedTopic.includes("#");

  const dismissNotice = () => {
    localStorage.setItem(WILDCARD_NOTICE_KEY, "true");
    setNoticeDismissed(true);
  };

  if (isWildcard) {
    if (noticeDismissed) return null;
    return (
      <div className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/25 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <WarningIcon className="text-sm text-warning shrink-0" />
          <span className="text-base-content/80 text-xs">
            Cannot publish to wildcard topics (<code className="font-mono font-semibold text-warning">+</code> / <code className="font-mono font-semibold text-warning">#</code>). Select a specific topic to publish.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-xs btn-ghost btn-square text-base-content/50 hover:text-base-content shrink-0"
          title="Dismiss warning"
          onClick={dismissNotice}
        >
          <CloseIcon className="text-sm" />
        </button>
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
