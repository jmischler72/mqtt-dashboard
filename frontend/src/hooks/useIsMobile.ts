import { useEffect, useState } from "react";

// Matches Tailwind's `sm` breakpoint boundary: below 640px is "mobile".
const MOBILE_QUERY = "(max-width: 639px)";

/**
 * Returns true when the viewport is at mobile width (< 640px).
 * Subscribes to viewport changes so it stays in sync without a resize-in-effect
 * that syncs into layout state.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
