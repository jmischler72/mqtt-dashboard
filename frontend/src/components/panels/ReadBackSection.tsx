import { RiSwap2Line } from "react-icons/ri";
import type { BrokerStatus } from "../../hooks/useBrokers";
import BrokerTopicSection from "./BrokerTopicSection";
import PayloadBuilder from "./PayloadBuilder";

interface Props {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  brokerStatuses: BrokerStatus[];
  brokerId: string;
  onBrokerChange: (brokerId: string) => void;
  topic: string;
  onTopicChange: (topic: string) => void;
  onPickTopic?: () => void;
  readTemplate: string;
  onReadTemplateChange: (template: string) => void;
  /** "state" for the toggle, "value" for the slider. */
  noun?: string;
}

/**
 * Where the panel reads back from, when that is not simply the topic it
 * publishes to in the shape it publishes.
 *
 * Off by default and collapsed to a single switch: the common case is a device
 * that reports on its own command topic, which needs no configuration at all.
 * Switching it on reveals a full broker/topic pair and a payload editor in read
 * mode, so an entirely different shape on an entirely different broker can be
 * described the same way the outgoing payload is.
 */
export default function ReadBackSection({
  enabled,
  onEnabledChange,
  brokerStatuses,
  brokerId,
  onBrokerChange,
  topic,
  onTopicChange,
  onPickTopic,
  readTemplate,
  onReadTemplateChange,
  noun = "value",
}: Props) {
  return (
    <div className="border border-base-300 bg-base-200/40 rounded-xl p-3.5 flex flex-col gap-3 transition-all">
      <label className="flex items-center justify-between w-full cursor-pointer group select-none">
        <div className="flex items-center gap-1.5 font-medium text-xs text-base-content/80 group-hover:text-base-content transition-colors">
          <RiSwap2Line className="text-accent text-sm shrink-0" />
          <span>Reads {noun} from a different topic</span>
        </div>
        <input
          type="checkbox"
          className="toggle toggle-xs toggle-primary"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
      </label>

      {!enabled && (
        <p className="text-[11px] text-base-content/60 leading-normal">
          The device reports on the command topic, in the same shape the panel
          publishes.
        </p>
      )}

      {enabled && (
        <div className="flex flex-col gap-3 pt-1 border-t border-base-300/60">
          <BrokerTopicSection
            selectedBrokerId={brokerId}
            onBrokerChange={onBrokerChange}
            brokerStatuses={brokerStatuses}
            topic={topic}
            onTopicChange={onTopicChange}
            onPickTopic={onPickTopic}
            topicLabel="State topic"
            allowWildcards={true}
            allowMultiple={false}
            helpText={`Where the device reports its actual ${noun}. Read-only, so wildcards are allowed.`}
          />

          <PayloadBuilder
            mode="read"
            template={readTemplate}
            onTemplateChange={onReadTemplateChange}
            previews={[]}
            brokerId={brokerId}
            topic={topic}
          />
        </div>
      )}
    </div>
  );
}
