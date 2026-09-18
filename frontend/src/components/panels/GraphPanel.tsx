import { useEffect, useMemo, useRef, useState } from "react";
import { MdShowChart } from "react-icons/md";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../api/client";
import { usePanelSize } from "../../hooks/usePanelSize";
import { usePayloadSample } from "../../hooks/usePayloadSample";
import type { BrokerStatus } from "../../hooks/useBrokers";
import {
  BrokerTopicCard,
  ChoiceCards,
  ConfigCard,
  ConfigGroup,
  DisclosureCard,
  FieldRow,
  NumberRangeRow,
  PanelConfigModal,
  PayloadBuilder,
  PayloadSummary,
  SwitchRow,
  brokerPresence,
  brokerRules,
  defaultBrokerId,
  payloadRules,
  topicRules,
  useConfigValidation,
} from "./config";
import { VALUE_TOKEN, readShape, templateFromValueKey } from "./payloadShape";
import {
  appendPoint,
  autoNumericPayload,
  buildAreaPath,
  buildLinePath,
  computeBounds,
  formatTimeLabel,
  formatValue,
  graphReadTemplate,
  nearestPoint,
  parseNumericPayload,
  projectX,
  projectY,
  seriesColor,
  trimSeries,
  valueTicks,
  type CurveType,
  type GraphSeries,
} from "./graphUtils";

export interface GraphConfig {
  topics?: string;
  /** Shape of incoming messages, with `{value}` marking the part to plot. */
  readTemplate?: string;
  /** Legacy dot path, kept so panels saved before shapes existed still read. */
  valueKey?: string;
  unit?: string;
  maxPoints?: number;
  timeWindowSeconds?: number;
  yMin?: number | null;
  yMax?: number | null;
  curve?: CurveType;
  showArea?: boolean;
  showPoints?: boolean;
  showLegend?: boolean;
}

export const DEFAULT_MAX_POINTS = 200;
export const DEFAULT_WINDOW_SECONDS = 900;
/** A wildcard can match hundreds of topics; past this the chart is unreadable. */
const MAX_SERIES = 12;

const TIME_WINDOWS: { value: number; label: string }[] = [
  { value: 60, label: "Last minute" },
  { value: 300, label: "Last 5 minutes" },
  { value: 900, label: "Last 15 minutes" },
  { value: 3600, label: "Last hour" },
  { value: 21600, label: "Last 6 hours" },
  { value: 86400, label: "Last 24 hours" },
  { value: 0, label: "All stored history" },
];

interface ModalProps {
  config: GraphConfig;
  brokerId: string;
  brokerStatuses: BrokerStatus[];
  onSave: (cfg: GraphConfig, brokerId: string) => void;
  onClose: () => void;
  onPickTopic?: (data: {
    currentTopic: string;
    selectedBrokerId: string;
    draftConfig?: GraphConfig;
  }) => void;
  initialTopic?: string;
  initialBrokerId?: string;
}

export function GraphConfigModal({
  config,
  brokerId,
  brokerStatuses,
  onSave,
  onClose,
  onPickTopic,
  initialTopic,
  initialBrokerId,
}: ModalProps) {
  const fallbackBroker = defaultBrokerId(brokerStatuses);
  const [topics, setTopics] = useState(initialTopic ?? config.topics ?? "");
  const [readTemplate, setReadTemplate] = useState(graphReadTemplate(config));
  const [unit, setUnit] = useState(config.unit ?? "");
  const [maxPoints, setMaxPoints] = useState(
    String(config.maxPoints ?? DEFAULT_MAX_POINTS),
  );
  const [timeWindowSeconds, setTimeWindowSeconds] = useState(
    config.timeWindowSeconds ?? DEFAULT_WINDOW_SECONDS,
  );
  const [yMin, setYMin] = useState(
    config.yMin === null || config.yMin === undefined
      ? ""
      : String(config.yMin),
  );
  const [yMax, setYMax] = useState(
    config.yMax === null || config.yMax === undefined
      ? ""
      : String(config.yMax),
  );
  const [curve, setCurve] = useState<CurveType>(config.curve ?? "linear");
  const [showArea, setShowArea] = useState(config.showArea ?? true);
  const [showPoints, setShowPoints] = useState(config.showPoints ?? false);
  const [showLegend, setShowLegend] = useState(config.showLegend ?? true);
  const [selectedBrokerId, setSelectedBrokerId] = useState(
    initialBrokerId || brokerId || fallbackBroker,
  );

  const { recent, loading } = usePayloadSample(selectedBrokerId, topics);
  const latest = recent[0]?.payload ?? null;

  // A stored dot path no shape can draw — an array index — is only held by this
  // field, so it is carried through saves and topic-picker round trips.
  const legacyPath =
    readTemplate.trim() === VALUE_TOKEN &&
    !templateFromValueKey(config.valueKey)
      ? config.valueKey
      : undefined;

  const reading = latest ? readShape(readTemplate, latest, legacyPath) : null;
  // "Nothing published yet" and "the shape does not fit" are different
  // problems; only a shape that resolved can say the payload is not a number.
  const nonNumeric =
    (reading?.found ?? false) &&
    reading?.dataType !== "number" &&
    reading?.dataType !== "boolean";

  const pointsNum = Number(maxPoints);
  const yMinNum = yMin.trim() === "" ? null : Number(yMin);
  const yMaxNum = yMax.trim() === "" ? null : Number(yMax);

  const { fieldErrors, blockerReason } = useConfigValidation([
    ...brokerRules(brokerStatuses.length),
    ...topicRules({ field: "topic", topic: topics, allowWildcards: true }),
    // Blank reads the whole payload, which is right for a device publishing a
    // bare number; bytes with nothing marked in them are a shape the panel
    // cannot use.
    ...payloadRules({
      field: "readShape",
      value: readTemplate,
      mode: "read",
      allowEmpty: true,
    }),
    {
      field: "points",
      when: !Number.isFinite(pointsNum) || pointsNum < 2 || pointsNum > 2000,
      message: "Points must be a number between 2 and 2000.",
    },
    {
      field: "scale",
      when:
        (yMin.trim() !== "" && !Number.isFinite(yMinNum as number)) ||
        (yMax.trim() !== "" && !Number.isFinite(yMaxNum as number)),
      message: "Min and Max must be numbers, or left blank to fit the data.",
    },
    {
      field: "scale",
      when:
        yMinNum !== null &&
        yMaxNum !== null &&
        Number.isFinite(yMinNum) &&
        Number.isFinite(yMaxNum) &&
        yMaxNum <= yMinNum,
      message: "Max must be greater than Min.",
    },
  ]);

  const draft = (): GraphConfig => ({
    topics,
    readTemplate,
    valueKey: legacyPath,
    unit,
    // A half-typed box comes back as it was left, not as the text `NaN` for
    // the user to clear again.
    maxPoints: Number.isFinite(pointsNum) ? pointsNum : config.maxPoints,
    timeWindowSeconds,
    yMin: yMinNum !== null && Number.isFinite(yMinNum) ? yMinNum : null,
    yMax: yMaxNum !== null && Number.isFinite(yMaxNum) ? yMaxNum : null,
    curve,
    showArea,
    showPoints,
    showLegend,
  });

  return (
    <PanelConfigModal
      icon={MdShowChart}
      title="Graph Configuration"
      brokerStatus={brokerPresence(brokerStatuses, selectedBrokerId)}
      blockerReason={blockerReason}
      onCancel={onClose}
      onSave={() => onSave(draft(), selectedBrokerId || fallbackBroker)}
    >
      <ConfigGroup heading="Read">
        <BrokerTopicCard
          title="Reads from"
          brokers={brokerStatuses}
          brokerId={selectedBrokerId}
          onBrokerChange={setSelectedBrokerId}
          topic={topics}
          onTopicChange={(next) => {
            setTopics(next);
          }}
          topicPlaceholder="sensors/+/temp, home/attic/humidity"
          topicError={fieldErrors.topic}
          help={`Every matching topic gets its own line, up to ${MAX_SERIES}. Read-only, so wildcards (+ and #) are fine.`}
          onExplore={
            onPickTopic
              ? () =>
                  onPickTopic({
                    currentTopic: "",
                    selectedBrokerId,
                    draftConfig: draft(),
                  })
              : undefined
          }
        />

        <DisclosureCard
          title="Value"
          summary={
            <PayloadSummary value={readTemplate} empty="whole payload" />
          }
          defaultOpen={Boolean(fieldErrors.readShape)}
          invalid={Boolean(fieldErrors.readShape)}
        >
          <PayloadBuilder
            mode="read"
            value={readTemplate}
            onChange={(next) => {
              setReadTemplate(next);
            }}
            history={{ messages: recent, loading }}
            brokerId={selectedBrokerId}
            topic={topics}
            allowBlankShape
            readPath={legacyPath}
            unit={unit}
            placeholder={`whole payload, or {"temp":${VALUE_TOKEN}}`}
          />
          {fieldErrors.readShape && (
            <span className="text-[11px] text-warning">
              {fieldErrors.readShape}
            </span>
          )}
          {nonNumeric && (
            <span className="text-[11px] leading-relaxed text-warning">
              The value this shape reads is text, and only numbers can be
              plotted. Booleans are drawn as 1 and 0; anything else is skipped.
            </span>
          )}
        </DisclosureCard>
      </ConfigGroup>

      <ConfigGroup heading="Appearance">
        <ConfigCard title="Line style" summary="How points are joined up">
          <ChoiceCards<CurveType>
            value={curve}
            onChange={setCurve}
            options={[
              {
                id: "linear",
                label: "Straight",
                preview: <CurvePreview curve="linear" />,
              },
              {
                id: "smooth",
                label: "Smooth",
                preview: <CurvePreview curve="smooth" />,
              },
              {
                id: "step",
                label: "Step",
                preview: <CurvePreview curve="step" />,
              },
            ]}
          />
          <SwitchRow
            name="Fill under the line"
            note="Tints the area down to the baseline"
            on={showArea}
            onToggle={setShowArea}
          />
          <SwitchRow
            name="Dot per message"
            note="Marks where each message landed"
            on={showPoints}
            onToggle={setShowPoints}
          />
          <SwitchRow
            name="Legend"
            note="Names each line and its latest value"
            on={showLegend}
            onToggle={setShowLegend}
          />
        </ConfigCard>

        <ConfigCard
          title="Window"
          summary="How much of the past is drawn"
          invalid={Boolean(fieldErrors.points)}
        >
          <FieldRow label="Range">
            <select
              className="select select-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              value={timeWindowSeconds}
              onChange={(e) => setTimeWindowSeconds(Number(e.target.value))}
            >
              {TIME_WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow
            label="Points"
            invalid={Boolean(fieldErrors.points)}
            help={
              fieldErrors.points ??
              "How many points each line keeps before dropping the oldest."
            }
          >
            <input
              className={`input input-bordered w-full min-w-0 h-8 min-h-8 font-mono text-xs ${
                fieldErrors.points ? "input-warning" : ""
              }`}
              inputMode="numeric"
              value={maxPoints}
              onChange={(e) => {
                setMaxPoints(e.target.value);
              }}
            />
          </FieldRow>
        </ConfigCard>

        <ConfigCard
          title="Scale"
          summary="Blank fits the data"
          invalid={Boolean(fieldErrors.scale)}
        >
          <NumberRangeRow
            fields={[
              {
                label: "Min",
                value: yMin,
                placeholder: "auto",
                invalid: Boolean(fieldErrors.scale),
                onChange: (next) => {
                  setYMin(next);
                },
              },
              {
                label: "Max",
                value: yMax,
                placeholder: "auto",
                invalid: Boolean(fieldErrors.scale),
                onChange: (next) => {
                  setYMax(next);
                },
              },
            ]}
          />
          {fieldErrors.scale && (
            <span className="text-[11px] text-warning">
              {fieldErrors.scale}
            </span>
          )}
          <FieldRow label="Unit" help="Shown next to values in the legend.">
            <input
              className="input input-bordered w-full min-w-0 h-8 min-h-8 text-xs"
              placeholder="°C, %, kW"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </FieldRow>
        </ConfigCard>
      </ConfigGroup>
    </PanelConfigModal>
  );
}

/** The three joins, drawn over the same points so the choice is the preview. */
function CurvePreview({ curve }: { curve: CurveType }) {
  const points = [
    { t: 0, v: 6 },
    { t: 1, v: 22 },
    { t: 2, v: 14 },
    { t: 3, v: 30 },
    { t: 4, v: 24 },
  ];
  const bounds = { minT: 0, maxT: 4, minV: 0, maxV: 34 };

  return (
    <svg viewBox="0 0 60 34" className="w-full h-full text-primary">
      <path
        d={buildLinePath(points, bounds, 60, 34, curve)}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface GraphPanelProps {
  panelId: string;
  brokerId: string;
  config: GraphConfig;
  /** Hides the Clear / Pause toolbar, for the explorer's compact view. */
  compact?: boolean;
  /**
   * Plot the first numeric field found in each payload instead of the panel's
   * configured shape. For the explorer, which charts whatever topic is clicked
   * and has nowhere to configure one.
   */
  autoValue?: boolean;
}

/** Room for the value axis on the left and the time labels underneath. */
const PADDING = { top: 8, right: 8, bottom: 18, left: 40 };

export default function GraphPanel({
  panelId,
  brokerId,
  config,
  compact = false,
  autoValue = false,
}: GraphPanelProps) {
  const [series, setSeries] = useState<GraphSeries[]>([]);
  // Messages are arriving but nothing plottable comes out of them — a different
  // problem from a topic that has simply been quiet, and the only one the user
  // can fix, so the two are never reported as one.
  const [nonNumericSeen, setNonNumericSeen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const { ref: plotRef, size } = usePanelSize<HTMLDivElement>();
  const pausedRef = useRef(paused);

  const topicsKey = config.topics ?? "";
  const readTemplate = graphReadTemplate(config);
  const shape = useMemo(
    () => ({ template: readTemplate, path: config.valueKey }),
    [readTemplate, config.valueKey],
  );
  const readPoint = useMemo(
    () =>
      autoValue
        ? (payload: string) => autoNumericPayload(payload)
        : (payload: string) => parseNumericPayload(payload, shape),
    [autoValue, shape],
  );
  const unit = config.unit ?? "";
  const maxPoints = config.maxPoints ?? DEFAULT_MAX_POINTS;
  const windowMs = (config.timeWindowSeconds ?? DEFAULT_WINDOW_SECONDS) * 1000;
  const curve = config.curve ?? "linear";
  const showArea = config.showArea ?? true;
  const showPoints = config.showPoints ?? false;
  const showLegend = config.showLegend ?? true;
  const yMin = config.yMin ?? undefined;
  const yMax = config.yMax ?? undefined;

  const topicList = useMemo(
    () =>
      topicsKey
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [topicsKey],
  );

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Drop buffered points when the source changes, so lines never mix topics.
  useEffect(() => {
    const id = setTimeout(() => {
      setSeries([]);
      setNonNumericSeen(false);
    }, 0);
    return () => clearTimeout(id);
  }, [brokerId, topicsKey, readPoint]);

  // Seed from stored history so a panel opens with its past already drawn.
  useEffect(() => {
    if (!brokerId || topicList.length === 0) return;
    let cancelled = false;

    Promise.all(
      topicList.map((topic) =>
        api.getExplorerHistory(brokerId, topic).catch((error) => {
          void error;
          return [];
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const now = Date.now();
      const options = { maxPoints, windowMs, now, maxSeries: MAX_SERIES };
      let seeded: GraphSeries[] = [];
      const records = results
        .flat()
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
      for (const record of records) {
        const value = readPoint(record.payload);
        if (value === null) continue;
        const t = new Date(record.timestamp).getTime();
        if (Number.isNaN(t)) continue;
        seeded = appendPoint(seeded, record.topic, { t, v: value }, options);
      }
      if (records.length > 0 && seeded.length === 0) {
        setNonNumericSeen(true);
      }
      // Fold in live points that arrived while history was in flight, rather
      // than replacing them and losing the newest readings.
      setSeries((prev) => {
        if (prev.length === 0) return seeded;
        let merged = seeded;
        for (const live of prev) {
          for (const point of live.points) {
            merged = appendPoint(merged, live.topic, point, options);
          }
        }
        return merged;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [brokerId, topicList, readPoint, maxPoints, windowMs]);

  const { subscribe } = useWebSocket({
    onMessage: (raw) => {
      if (pausedRef.current) return;
      try {
        const msg = JSON.parse(raw) as {
          topic: string;
          payload: string;
          timestamp?: string;
        };
        if (!msg.topic) return;
        const value = readPoint(msg.payload);
        if (value === null) {
          setNonNumericSeen(true);
          return;
        }
        const stamped = msg.timestamp ? new Date(msg.timestamp).getTime() : NaN;
        const t = Number.isNaN(stamped) ? Date.now() : stamped;
        setSeries((prev) =>
          appendPoint(
            prev,
            msg.topic,
            { t, v: value },
            {
              maxPoints,
              windowMs,
              now: Date.now(),
              maxSeries: MAX_SERIES,
            },
          ),
        );
      } catch (error) {
        void error;
      }
    },
  });

  useEffect(() => {
    if (topicList.length === 0) return;
    subscribe({ panel_id: panelId, broker_id: brokerId, topics: topicList });
  }, [panelId, brokerId, topicList, subscribe]);

  // Expire points that scrolled out of the window even while nothing arrives,
  // so a silent topic drains instead of freezing on its last reading.
  useEffect(() => {
    if (windowMs <= 0) return;
    const interval = setInterval(() => {
      setSeries((prev) => {
        const next = trimSeries(prev, { maxPoints, windowMs });
        const unchanged =
          next.length === prev.length &&
          next.every((s, i) => s.points.length === prev[i].points.length);
        return unchanged ? prev : next;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [windowMs, maxPoints]);

  const bounds = useMemo(
    () => computeBounds(series, yMin, yMax),
    [series, yMin, yMax],
  );

  // One tinted area reads as the shape of the value; five stacked on top of
  // each other read as mud, so the fill is for a single line only.
  const fillArea = showArea && series.length === 1;

  const plotWidth = Math.max(0, size.width - PADDING.left - PADDING.right);
  const plotHeight = Math.max(0, size.height - PADDING.top - PADDING.bottom);
  const totalPoints = series.reduce((sum, s) => sum + s.points.length, 0);

  const hoverInfo = useMemo(() => {
    if (hoverX === null || !bounds || plotWidth <= 0) return null;
    const ratio = Math.min(Math.max(hoverX / plotWidth, 0), 1);
    const t = bounds.minT + (bounds.maxT - bounds.minT) * ratio;
    const entries = series
      .map((s, index) => ({
        topic: s.topic,
        index,
        point: nearestPoint(s.points, t),
      }))
      .filter(
        (
          entry,
        ): entry is {
          topic: string;
          index: number;
          point: { t: number; v: number };
        } => entry.point !== null,
      );
    if (entries.length === 0) return null;
    return { t, entries };
  }, [hoverX, bounds, plotWidth, series]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {!compact && (
        <div className="flex gap-2 px-1 pb-1 shrink-0">
          <button className="btn btn-xs" onClick={() => setSeries([])}>
            Clear
          </button>
          <button
            className={`btn btn-xs ${paused ? "btn-warning" : ""}`}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <span className="text-xs text-base-content/50 ml-auto self-center">
            {totalPoints} pts
          </span>
        </div>
      )}

      <div
        ref={plotRef}
        className="relative flex-1 min-h-0 w-full overflow-hidden"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(e.clientX - rect.left - PADDING.left);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {!bounds || plotWidth <= 0 || plotHeight <= 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
            {nonNumericSeen ? (
              <>
                <MdShowChart className="text-3xl text-base-content/30" />
                <span className="text-xs text-base-content/60 leading-relaxed max-w-xs">
                  Messages are arriving on{" "}
                  <span className="font-mono text-accent">{topicsKey}</span>,
                  but the value read out of them is not a number. Point the
                  value shape at the numeric field in this panel's settings.
                </span>
              </>
            ) : (
              <>
                <div className="loading loading-spinner loading-md text-primary" />
                <span className="text-xs text-base-content/60 font-mono animate-pulse">
                  Waiting for numeric data on{" "}
                  <span className="font-semibold text-accent">{topicsKey}</span>
                  …
                </span>
              </>
            )}
          </div>
        ) : (
          <svg
            width={size.width}
            height={size.height}
            className="block"
            role="img"
            aria-label={`Graph of ${topicsKey}`}
          >
            <g transform={`translate(${PADDING.left}, ${PADDING.top})`}>
              {valueTicks(bounds).map((tick) => {
                const y = projectY(tick, bounds, plotHeight);
                return (
                  <g key={tick}>
                    <line
                      x1={0}
                      x2={plotWidth}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      strokeWidth={1}
                      className="text-base-content/10"
                    />
                    <text
                      x={-6}
                      y={y}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="fill-base-content/50 font-mono"
                      style={{ fontSize: "9px" }}
                    >
                      {formatValue(tick)}
                    </text>
                  </g>
                );
              })}

              {[0, 0.5, 1].map((ratio) => {
                const t = bounds.minT + (bounds.maxT - bounds.minT) * ratio;
                return (
                  <text
                    key={ratio}
                    x={plotWidth * ratio}
                    y={plotHeight + 12}
                    textAnchor={
                      ratio === 0 ? "start" : ratio === 1 ? "end" : "middle"
                    }
                    className="fill-base-content/50 font-mono"
                    style={{ fontSize: "9px" }}
                  >
                    {formatTimeLabel(t)}
                  </text>
                );
              })}

              {series.map((s, index) => {
                const color = seriesColor(index);
                const linePath = buildLinePath(
                  s.points,
                  bounds,
                  plotWidth,
                  plotHeight,
                  curve,
                );
                return (
                  <g key={s.topic} className={color.stroke}>
                    {fillArea && (
                      <path
                        d={buildAreaPath(
                          linePath,
                          s.points,
                          bounds,
                          plotWidth,
                          plotHeight,
                        )}
                        fill="currentColor"
                        className="opacity-10"
                        stroke="none"
                      />
                    )}
                    <path
                      d={linePath}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {showPoints &&
                      s.points.map((p) => (
                        <circle
                          key={`${p.t}-${p.v}`}
                          cx={projectX(p.t, bounds, plotWidth)}
                          cy={projectY(p.v, bounds, plotHeight)}
                          r={2}
                          fill="currentColor"
                        />
                      ))}
                  </g>
                );
              })}

              {hoverInfo && (
                <g>
                  <line
                    x1={projectX(hoverInfo.t, bounds, plotWidth)}
                    x2={projectX(hoverInfo.t, bounds, plotWidth)}
                    y1={0}
                    y2={plotHeight}
                    stroke="currentColor"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    className="text-base-content/30"
                  />
                  {hoverInfo.entries.map((entry) => (
                    <circle
                      key={entry.topic}
                      cx={projectX(entry.point.t, bounds, plotWidth)}
                      cy={projectY(entry.point.v, bounds, plotHeight)}
                      r={3.5}
                      fill="currentColor"
                      className={seriesColor(entry.index).stroke}
                    />
                  ))}
                </g>
              )}
            </g>
          </svg>
        )}

        {hoverInfo && bounds && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-base-300 bg-base-100/95 px-2 py-1 shadow-lg text-[10px] font-mono max-w-[70%]"
            style={{
              left: Math.min(
                Math.max(
                  PADDING.left + projectX(hoverInfo.t, bounds, plotWidth) + 8,
                  4,
                ),
                Math.max(4, size.width - 140),
              ),
            }}
          >
            <div className="text-base-content/50">
              {formatTimeLabel(hoverInfo.t)}
            </div>
            {hoverInfo.entries.map((entry) => (
              <div key={entry.topic} className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${seriesColor(entry.index).swatch}`}
                />
                {series.length > 1 && (
                  <span className="truncate max-w-[110px] text-base-content/60">
                    {entry.topic}
                  </span>
                )}
                <span className="font-semibold text-base-content ml-auto">
                  {formatValue(entry.point.v)}
                  {unit && (
                    <span className="text-base-content/60"> {unit}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showLegend && series.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 shrink-0 text-[10px] text-base-content/60">
          {series.length >= MAX_SERIES && (
            <span className="text-warning shrink-0">
              first {MAX_SERIES} topics
            </span>
          )}
          {series.map((s, index) => {
            const last = s.points[s.points.length - 1];
            return (
              <div key={s.topic} className="flex items-center gap-1 min-w-0">
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${seriesColor(index).swatch}`}
                />
                <span className="truncate max-w-[140px] font-mono">
                  {s.topic}
                </span>
                {last && (
                  <span className="font-semibold text-base-content shrink-0">
                    {formatValue(last.v)}
                    {unit ? ` ${unit}` : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
