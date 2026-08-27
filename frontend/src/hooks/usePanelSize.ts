import { useCallback, useEffect, useState } from "react";

export interface PanelSize {
  width: number;
  height: number;
}

/**
 * Tracks the rendered size of a panel container so panels can scale their
 * content with the grid cell instead of relying on fixed font/element sizes.
 *
 * Attach the returned ref to the panel root; `size` updates on panel resize
 * (drag handles) as well as window resize. The ref is a callback ref so the
 * observer also attaches to roots that appear on a later render — panels
 * commonly render a ref-less empty state until they are configured.
 *
 * Sizes are border-box (padding included), so callers subtract their own
 * padding when deriving available space.
 */
export function usePanelSize<T extends HTMLElement = HTMLDivElement>(): {
  ref: (node: T | null) => void;
  size: PanelSize;
} {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<PanelSize>({ width: 0, height: 0 });

  const ref = useCallback((next: T | null) => setNode(next), []);

  useEffect(() => {
    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      const w = rect.width || node.offsetWidth;
      const h = rect.height || node.offsetHeight;
      if (w > 0 && h > 0) {
        setSize({ width: w, height: h });
      }
    };

    measure();
    // Grid panels can still be settling on first paint.
    const timer = setTimeout(measure, 100);
    window.addEventListener("resize", measure);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        clearTimeout(timer);
        window.removeEventListener("resize", measure);
      };
    }

    // Measure through the same path as the fallback so both report the same
    // box model; contentRect would be padding-excluded and cause a jump.
    const observer = new ResizeObserver(measure);
    observer.observe(node);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [node]);

  return { ref, size };
}
