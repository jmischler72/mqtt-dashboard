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
  depth: number;
}

function TreeNodeItem({
  node,
  selectedTopic,
  flashTopics,
  onSelect,
  depth,
}: NodeProps) {
  const [open, setOpen] = useState(depth < 2);
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
      >
        {hasChildren ? (
          <span
            className="text-base-content/50 w-3 shrink-0 text-xl mb-1 "
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) setOpen((o) => !o);
            }}
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
              depth={depth + 1}
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
}

export default function TopicTree({
  topics,
  liveMessages,
  selectedTopic,
  onSelectTopic,
}: TopicTreeProps) {
  const tree = buildTree(topics);
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
      {Array.from(tree.values()).map((node) => (
        <TreeNodeItem
          key={node.fullPath}
          node={node}
          selectedTopic={selectedTopic}
          flashTopics={flashTopics}
          onSelect={onSelectTopic}
          depth={0}
        />
      ))}
    </div>
  );
}
