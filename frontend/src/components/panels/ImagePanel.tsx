import { useEffect, useState } from "react";

export interface ImageConfig {
  src?: string;
}

interface PresetEntry {
  name: string;
  url: string;
}

interface ModalProps {
  config: ImageConfig;
  onSave: (cfg: ImageConfig, brokerId: string) => void;
  onClose: () => void;
}

type ModalTab = "url" | "upload" | "presets";

export function ImageConfigModal({ config, onSave, onClose }: ModalProps) {
  const [src, setSrc] = useState(config.src ?? "");
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ModalTab>("url");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/images/presets")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PresetEntry[]) => {
        if (active) setPresets(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/images", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const entry = (await res.json()) as PresetEntry;
      setSrc(entry.url);
      setPresets((prev) =>
        prev.some((p) => p.name === entry.name) ? prev : [...prev, entry],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-h-[85vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Image Configuration</h3>

        <div
          role="tablist"
          className="tabs tabs-boxed bg-base-200 mb-4 p-1 gap-1"
        >
          <a
            role="tab"
            className={`tab flex-1 ${tab === "url" ? "tab-active bg-primary text-primary-content" : ""}`}
            onClick={() => setTab("url")}
          >
            URL
          </a>
          <a
            role="tab"
            className={`tab flex-1 ${tab === "upload" ? "tab-active bg-primary text-primary-content" : ""}`}
            onClick={() => setTab("upload")}
          >
            Upload
          </a>
          <a
            role="tab"
            className={`tab flex-1 ${tab === "presets" ? "tab-active bg-primary text-primary-content" : ""}`}
            onClick={() => setTab("presets")}
          >
            Presets
          </a>
        </div>

        {tab === "url" && (
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Image URL</legend>
            <input
              className="input input-bordered w-full"
              placeholder="https://example.com/image.png"
              value={src}
              onChange={(e) => setSrc(e.target.value)}
            />
            <p className="fieldset-label">Paste a direct link to an image.</p>
          </fieldset>
        )}

        {tab === "upload" && (
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Upload a file</legend>
            <label
              className={`flex flex-col items-center justify-center gap-1 rounded-box border-2 border-dashed p-7 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-base-300 hover:border-base-content/30"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleUpload(file);
              }}
            >
              <input
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                }}
              />
              <span className="text-sm font-medium text-base-content/70">
                {uploading
                  ? "Uploading…"
                  : "Drop an image here, or click to browse"}
              </span>
              <span className="text-xs text-base-content/40">
                PNG, JPG, GIF, WebP, SVG
              </span>
            </label>
            {error && <span className="text-xs text-error mt-1">{error}</span>}
          </fieldset>
        )}

        {tab === "presets" && (
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Previously uploaded</legend>
            {presets.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {presets.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    className={`relative border-2 rounded-box overflow-hidden aspect-4/3 ${src === p.url ? "border-primary" : "border-base-300"}`}
                    onClick={() => setSrc(p.url)}
                  >
                    <img
                      src={p.url}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 to-transparent text-white text-[10px] px-1.5 pt-2.5 pb-1 truncate">
                      {p.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-base-content/40">
                <p className="text-sm font-medium">No uploads yet</p>
                <p className="text-xs mt-1">
                  Images you upload will show up here for reuse
                </p>
              </div>
            )}
          </fieldset>
        )}

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="fieldset-legend">Preview</span>
            {src && (
              <button
                type="button"
                className="link link-hover text-xs text-base-content/60"
                onClick={() => setSrc("")}
              >
                Clear
              </button>
            )}
          </div>
          <div className="border border-base-300 rounded-box p-2 h-32 flex items-center justify-center">
            {src ? (
              <img
                src={src}
                alt="preview"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-base-content/40">
                No image selected
              </span>
            )}
          </div>
        </div>

        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ src }, "")}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

interface ImagePanelProps {
  config: ImageConfig;
}

export default function ImagePanel({ config }: ImagePanelProps) {
  const [broken, setBroken] = useState(false);

  if (!config.src) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
        No image — open settings to choose one
      </div>
    );
  }

  if (broken) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
        Image failed to load
      </div>
    );
  }

  return (
    <img
      src={config.src}
      alt=""
      className="h-full w-full object-contain"
      onError={() => setBroken(true)}
    />
  );
}
