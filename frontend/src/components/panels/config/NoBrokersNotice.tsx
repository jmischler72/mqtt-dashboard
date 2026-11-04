import { RiAlertLine } from "react-icons/ri";
import { appPath } from "../../../runtime";

/** The one thing a config modal cannot fix on its own. */
export default function NoBrokersNotice() {
  return (
    <div role="alert" className="alert alert-warning text-xs p-2.5 shadow-sm flex items-center gap-2">
      <RiAlertLine className="text-sm shrink-0" />
      <span className="text-[11.5px] leading-relaxed">
        No brokers configured.{" "}
        <a href={appPath("/config?tab=brokers")} className="link font-semibold underline">
          Add broker in Settings
        </a>
      </span>
    </div>
  );
}
