import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface PanelSize {
  width: number;
  height: number;
}

/**
 * Tracks the rendered size of a panel container so panels can scale their
 * content with the grid cell instead of relying on fixed font/element sizes.
 *
 * Attach the returned ref to the panel root; `size` updates on panel resize
 * (drag handles) as well as window resize.
 */
export function usePanelSize<T extends HTMLElement = HTMLDivElement>(): {
  ref: RefObject<T | null>;
  size: PanelSize;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<PanelSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const w = el.offsetWidth || el.getBoundingClientRect().width;
      const h = el.offsetHeight || el.getBoundingClientRect().height;
      if (w > 0 && h > 0) {
        setSize({ width: w, height: h });
      }
    };

    measure();
    // Grid panels can still be settling on first paint.
    const timer = setTimeout(measure, 100);

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("resize", measure);
      };
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const w = entry.contentRect.width || el.offsetWidth;
        const h = entry.contentRect.height || el.offsetHeight;
        if (w > 0 && h > 0) {
          setSize({ width: w, height: h });
        }
      }
    });

    observer.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { ref, size };
}
