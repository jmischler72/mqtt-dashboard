import { useState } from "react";
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
