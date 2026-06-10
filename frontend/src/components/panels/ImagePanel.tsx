import { useEffect, useState } from "react";

export interface ImageConfig {
  src?: string;
  fit?: "cover" | "contain" | "fill";
  alt?: string;
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

export function ImageConfigModal({ config, onSave, onClose }: ModalProps) {
  const [src, setSrc] = useState(config.src ?? "");
  const [fit, setFit] = useState<NonNullable<ImageConfig["fit"]>>(
    config.fit ?? "contain",
  );
  const [alt, setAlt] = useState(config.alt ?? "");
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className="flex flex-col gap-3">
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Image URL</legend>
            <input
              className="input input-bordered w-full"
              placeholder="https://example.com/logo.png"
              value={src}
              onChange={(e) => setSrc(e.target.value)}
            />
          </fieldset>

          <fieldset className="fieldset">
            <legend className="fieldset-legend">Upload</legend>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              className="file-input file-input-bordered w-full"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            {uploading && (
              <span className="text-xs text-base-content/60 mt-1">
                Uploading…
              </span>
            )}
            {error && (
              <span className="text-xs text-error mt-1">{error}</span>
            )}
          </fieldset>

          {presets.length > 0 && (
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Presets</legend>
              <div className="grid grid-cols-4 gap-2">
                {presets.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    className={`border rounded-box p-1 h-16 flex items-center justify-center overflow-hidden ${src === p.url ? "border-primary border-2" : "border-base-300"}`}
                    onClick={() => setSrc(p.url)}
                  >
                    <img
                      src={p.url}
                      alt={p.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {src && (
            <div className="border border-base-300 rounded-box p-2 h-32 flex items-center justify-center">
              <img
                src={src}
                alt="preview"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Fit</legend>
              <select
                className="select select-bordered"
                value={fit}
                onChange={(e) =>
                  setFit(e.target.value as NonNullable<ImageConfig["fit"]>)
                }
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="fill">Fill</option>
              </select>
            </fieldset>
            <fieldset className="fieldset flex-1">
              <legend className="fieldset-legend">Alt text</legend>
              <input
                className="input input-bordered w-full"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
            </fieldset>
          </div>
        </div>

        <div className="modal-action">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave({ src, fit, alt }, "")}
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
      alt={config.alt ?? ""}
      className="h-full w-full"
      style={{ objectFit: config.fit ?? "contain" }}
      onError={() => setBroken(true)}
    />
  );
}
