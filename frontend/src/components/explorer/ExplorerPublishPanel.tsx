import { useState } from "react";
import { RiErrorWarningLine as WarningIcon } from "react-icons/ri";
import InputPanel from "../panels/InputPanel";
import MqttOptionsSection from "../panels/MqttOptionsSection";

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

  const isWildcard = selectedTopic.includes("+") || selectedTopic.includes("#");

  if (isWildcard) {
    return (
      <div className="border border-base-300 bg-base-200/40 rounded-xl p-3 text-xs flex flex-col gap-1">
        <div className="flex items-center gap-1.5 font-semibold text-base-content">
          <WarningIcon className="text-warning text-sm shrink-0" />
          <span>Cannot publish to wildcard topic</span>
        </div>
        <p className="text-[11px] text-base-content/60 leading-normal">
          Topics with wildcards (<code className="font-mono text-warning">+</code> or <code className="font-mono text-warning">#</code>) cannot receive published messages. Select a specific sub-topic to publish.
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
      <MqttOptionsSection
        qos={qos}
        retain={retain}
        onQosChange={setQos}
        onRetainChange={setRetain}
      />
    </div>
  );
}
