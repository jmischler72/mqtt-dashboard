import { appPath } from "../../../runtime";

/** The one thing a config modal cannot fix on its own. */
export default function NoBrokersNotice() {
  return (
    <div role="alert" className="alert alert-warning text-xs p-2.5 shadow-sm">
      <span className="font-bold shrink-0">!</span>
      <span className="text-[11.5px] leading-relaxed">
        No brokers configured yet.{" "}
        <a href={appPath("/config")} className="link font-semibold underline">
          Add one in Config
        </a>{" "}
        — everything else here can wait.
      </span>
    </div>
  );
}
