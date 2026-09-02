/** The one thing a config modal cannot fix on its own. */
export default function NoBrokersNotice() {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg border border-warning bg-warning/10">
      <span className="text-warning shrink-0 font-semibold">!</span>
      <span className="text-[11.5px] leading-relaxed">
        No brokers configured yet.{" "}
        <a href="/config" className="link link-primary">
          Add one in Config
        </a>{" "}
        — everything else here can wait.
      </span>
    </div>
  );
}
