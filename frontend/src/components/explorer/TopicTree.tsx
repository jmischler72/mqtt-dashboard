import { useState, useEffect, useRef } from "react";

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
}

function TreeNodeItem({
  node,
  selectedTopic,
  flashTopics,
  onSelect,
  onDoubleClickTopic,
  depth,
  defaultExpanded,
}: NodeProps) {
  const [open, setOpen] = useState(defaultExpanded);
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
            className="text-base-content/50 w-3 shrink-0 text-xl mb-1 "
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
          {node.name}
        </span>
      </div>
      {hasChildren && open && (
        <div>
          {Array.from(node.children.values()).map((child) => (
            <TreeNodeItem
              key={child.fullPath}
              node={child}
              selectedTopic={selectedTopic}
              flashTopics={flashTopics}
              onSelect={onSelect}
              onDoubleClickTopic={onDoubleClickTopic}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TopicTreeProps {
  topics: string[];
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

  if (tree.size === 0) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-sm p-4 text-center">
        No topics captured yet.
        <br />
        Messages will appear once the broker starts sending data.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full py-1">
      {/* Synthetic wildcard row: select all topics at once */}
      <div
        className={`flex items-center gap-1 mx-2 mb-1 px-2 py-1 rounded cursor-pointer select-none text-sm font-semibold transition-colors duration-300
                    ${selectedTopic === "#" ? "bg-primary text-primary-content" : "bg-base-200 hover:bg-base-300"}`}
        onClick={() => onSelectTopic("#")}
      >
        <span className="font-mono truncate"># (all topics)</span>
      </div>
      {Array.from(tree.values()).map((node) => (
        <TreeNodeItem
          key={`${node.fullPath}:${expandCollapseVersion}`}
          node={node}
          selectedTopic={selectedTopic}
          flashTopics={flashTopics}
          onSelect={onSelectTopic}
          onDoubleClickTopic={onDoubleClickTopic}
          depth={0}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </div>
  );
}
