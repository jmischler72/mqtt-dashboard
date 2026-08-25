import { useState, useEffect, useRef, type ReactNode } from "react";

interface HighlightTextProps {
  name: string;
  fullPath: string;
  query: string;
  isSelected?: boolean;
}

function HighlightText({
  name,
  fullPath,
  query,
  isSelected,
}: HighlightTextProps): ReactNode {
  const trimmed = query.trim();
  if (!trimmed || trimmed === "+" || trimmed === "#" || trimmed === "*") {
    return name;
  }

  const nodeStart = fullPath.length - name.length;
  const nodeEnd = fullPath.length;

  const lowerFullPath = fullPath.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();

  // Find all match intervals [start, end] in fullPath
  const intervals: [number, number][] = [];

  // 1. Direct substring match on fullPath
  let searchIdx = 0;
  while (searchIdx <= lowerFullPath.length - lowerQuery.length) {
    const idx = lowerFullPath.indexOf(lowerQuery, searchIdx);
    if (idx === -1) break;
    intervals.push([idx, idx + lowerQuery.length]);
    searchIdx = idx + 1;
  }

  // 2. Also match individual tokens if query has path separators or wildcards
  if (
    lowerQuery.includes("/") ||
    lowerQuery.includes("+") ||
    lowerQuery.includes("#") ||
    lowerQuery.includes("*")
  ) {
    const tokens = lowerQuery.split(/[/+#*]+/).filter((t) => t.length > 0);
    for (const token of tokens) {
      let tIdx = 0;
      while (tIdx <= lowerFullPath.length - token.length) {
        const found = lowerFullPath.indexOf(token, tIdx);
        if (found === -1) break;
        intervals.push([found, found + token.length]);
        tIdx = found + 1;
      }
    }
  }

  // Intersect intervals with [nodeStart, nodeEnd] and convert to name-relative offsets
  const nameIntervals: [number, number][] = [];
  for (const [start, end] of intervals) {
    const overlapStart = Math.max(start, nodeStart);
    const overlapEnd = Math.min(end, nodeEnd);
    if (overlapStart < overlapEnd) {
      nameIntervals.push([overlapStart - nodeStart, overlapEnd - nodeStart]);
    }
  }

  if (nameIntervals.length === 0) {
    return name;
  }

  // Merge overlapping nameIntervals
  nameIntervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const curr of nameIntervals) {
    if (merged.length === 0) {
      merged.push(curr);
    } else {
      const prev = merged[merged.length - 1];
      if (curr[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }
  }

  // Build the highlighted React nodes
  const parts: ReactNode[] = [];
  let lastIdx = 0;

  for (let i = 0; i < merged.length; i++) {
    const [start, end] = merged[i];
    if (start > lastIdx) {
      parts.push(name.slice(lastIdx, start));
    }
    parts.push(
      <mark
        key={i}
        className={
          isSelected
            ? "bg-accent/40 text-primary-content font-bold px-0.5 rounded-xs"
            : "bg-warning/25 text-warning font-bold px-0.5 rounded-xs"
        }
      >
        {name.slice(start, end)}
      </mark>,
    );
    lastIdx = end;
  }

  if (lastIdx < name.length) {
    parts.push(name.slice(lastIdx));
  }

  return <>{parts}</>;
}

interface WSMessage {
  topic: string;
  payload: string;
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  isLeaf: boolean;
}

function buildTree(topics: string[]): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>();
  for (const topic of topics) {
    const parts = topic.split("/");
    let current = root;
    let path = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      path = i === 0 ? part : `${path}/${part}`;
      if (!current.has(part)) {
        current.set(part, {
          name: part,
          fullPath: path,
          children: new Map(),
          isLeaf: false,
        });
      }
      const node = current.get(part)!;
      if (i === parts.length - 1) node.isLeaf = true;
      current = node.children;
    }
  }
  return root;
}

interface NodeProps {
  node: TreeNode;
  selectedTopic: string | null;
  flashTopics: Set<string>;
  onSelect: (topic: string) => void;
  onDoubleClickTopic?: (topic: string) => void;
  depth: number;
  defaultExpanded: boolean;
  filterText?: string;
  expandCollapseVersion?: number;
}

function TreeNodeItem({
  node,
  selectedTopic,
  flashTopics,
  onSelect,
  onDoubleClickTopic,
  depth,
  defaultExpanded,
  filterText,
  expandCollapseVersion,
}: NodeProps) {
  const isFiltered = Boolean(filterText?.trim());
  const [open, setOpen] = useState(isFiltered || defaultExpanded);
  const hasChildren = node.children.size > 0;
  const isSelected = node.fullPath === selectedTopic;
  const isFlashing = flashTopics.has(node.fullPath);

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer select-none text-sm transition-colors duration-300
                    ${isSelected ? "bg-primary text-primary-content" : isFlashing ? "bg-info/30" : "hover:bg-base-200"}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          onSelect(node.fullPath);
        }}
        onDoubleClick={() => onDoubleClickTopic?.(node.fullPath)}
      >
        {hasChildren ? (
          <span
            className="text-base-content/50 w-3 shrink-0 text-xl mb-1"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) setOpen((o) => !o);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {open ? "▾" : "▸"}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span
          className={`font-mono truncate ${node.isLeaf && !hasChildren ? "text-accent" : ""}`}
        >
          <HighlightText
            name={node.name}
            fullPath={node.fullPath}
            query={filterText ?? ""}
            isSelected={isSelected}
          />
        </span>
      </div>
      {hasChildren && open && (
        <div>
          {Array.from(node.children.values()).map((child) => (
            <TreeNodeItem
              key={`${child.fullPath}:${expandCollapseVersion ?? 0}:${filterText ?? ""}`}
              node={child}
              selectedTopic={selectedTopic}
              flashTopics={flashTopics}
              onSelect={onSelect}
              onDoubleClickTopic={onDoubleClickTopic}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
              filterText={filterText}
              expandCollapseVersion={expandCollapseVersion}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TopicTreeProps {
  topics: string[];
  allTopicsCount?: number;
  filterText?: string;
  onClearFilter?: () => void;
  liveMessages: WSMessage[];
  selectedTopic: string | null;
  onSelectTopic: (topic: string) => void;
  onDoubleClickTopic?: (topic: string) => void;
  showSysTopic?: boolean;
  defaultExpanded?: boolean;
  expandCollapseVersion?: number;
}

export default function TopicTree({
  topics,
  allTopicsCount,
  filterText = "",
  onClearFilter,
  liveMessages,
  selectedTopic,
  onSelectTopic,
  onDoubleClickTopic,
  showSysTopic = false,
  defaultExpanded = false,
  expandCollapseVersion = 0,
}: TopicTreeProps) {
  // Filter out $SYS topics if showSysTopic is false
  const filteredTopics = showSysTopic
    ? topics
    : topics.filter((t) => !t.startsWith("$SYS/"));

  const tree = buildTree(filteredTopics);
  const [flashTopics, setFlashTopics] = useState<Set<string>>(new Set());
  const lastMessageRef = useRef<WSMessage | null>(null);

  useEffect(() => {
    if (liveMessages.length === 0) return;
    const latest = liveMessages[liveMessages.length - 1];
    if (latest === lastMessageRef.current) return;
    lastMessageRef.current = latest;

    // Collect all ancestor paths to flash
    const parts = latest.topic.split("/");
    const paths = new Set<string>();
    let path = "";
    for (let i = 0; i < parts.length; i++) {
      path = i === 0 ? parts[i] : `${path}/${parts[i]}`;
      paths.add(path);
    }

    setFlashTopics(paths);
    const timer = setTimeout(() => setFlashTopics(new Set()), 600);
    return () => clearTimeout(timer);
  }, [liveMessages]);

  const isFiltered = Boolean(filterText.trim());
  const totalCount = allTopicsCount ?? topics.length;

  if (totalCount === 0) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-sm p-4 text-center">
        No topics captured yet.
        <br />
        Messages will appear once the broker starts sending data.
      </div>
    );
  }

  if (tree.size === 0 && isFiltered) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-base-content/50 text-xs p-4 text-center gap-2">
        <span>No topics matching &ldquo;{filterText}&rdquo;</span>
        {onClearFilter && (
          <button
            type="button"
            className="btn btn-xs btn-outline btn-primary"
            onClick={onClearFilter}
          >
            Clear filter
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full py-1">
      {/* Synthetic wildcard row: select all topics at once (only shown when not filtered) */}
      {!isFiltered && (
        <div
          className={`flex items-center gap-1 mx-2 mb-1 px-2 py-1 rounded cursor-pointer select-none text-sm font-semibold transition-colors duration-300
                      ${selectedTopic === "#" ? "bg-primary text-primary-content" : "bg-base-200 hover:bg-base-300"}`}
          onClick={() => onSelectTopic("#")}
        >
          <span className="font-mono truncate"># (all topics)</span>
        </div>
      )}
      {Array.from(tree.values()).map((node) => (
        <TreeNodeItem
          key={`${node.fullPath}:${expandCollapseVersion}:${filterText}`}
          node={node}
          selectedTopic={selectedTopic}
          flashTopics={flashTopics}
          onSelect={onSelectTopic}
          onDoubleClickTopic={onDoubleClickTopic}
          depth={0}
          defaultExpanded={defaultExpanded}
          filterText={filterText}
          expandCollapseVersion={expandCollapseVersion}
        />
      ))}
    </div>
  );
}
