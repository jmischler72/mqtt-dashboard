import type { PanelDefinition } from "./types";

interface Props {
  definition: PanelDefinition;
}

export default function PanelPreviewCard({ definition }: Props) {
  if (definition.preview) {
    return <>{definition.preview}</>;
  }

  const Icon = definition.icon;

  return (
    <div className="flex flex-col h-full justify-between p-2">
      <div>
        <div className="flex items-center justify-between gap-1 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon size={14} className="text-primary shrink-0" />
            <span className="font-semibold text-xs truncate">
              {definition.label}
            </span>
          </div>
          {definition.version && (
            <span className="badge badge-xs badge-neutral font-mono shrink-0">
              v{definition.version}
            </span>
          )}
        </div>
        {definition.description ? (
          <p className="text-xs text-base-content/70 line-clamp-3 leading-relaxed">
            {definition.description}
          </p>
        ) : (
          <p className="text-xs text-base-content/40 italic">
            No description provided
          </p>
        )}
      </div>

      {(definition.author || definition.repository) && (
        <div className="text-[10px] text-base-content/50 pt-2 border-t border-base-200 flex justify-between items-center">
          {definition.author ? (
            <span className="truncate">by {definition.author}</span>
          ) : (
            <span />
          )}
          {definition.repository && (
            <span className="text-primary font-mono text-[9px] shrink-0">
              GitHub
            </span>
          )}
        </div>
      )}
    </div>
  );
}
