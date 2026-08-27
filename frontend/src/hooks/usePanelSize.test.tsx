import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelSize } from "./usePanelSize";

const observed: Element[] = [];
let triggerResize: (() => void) | null = null;

class ResizeObserverStub {
  constructor(callback: () => void) {
    triggerResize = () => callback();
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {}
  unobserve() {}
}

function sizedRect(width: number, height: number) {
  return () => ({ width, height }) as DOMRect;
}

// Renders a ref-less empty state until configured, like the cron panel does.
function Panel({ configured }: { configured: boolean }) {
  const { ref, size } = usePanelSize<HTMLDivElement>();
  if (!configured) return <div>not configured</div>;
  return (
    <div ref={ref} data-testid="root">
      {size.width}x{size.height}
    </div>
  );
}

describe("usePanelSize", () => {
  beforeEach(() => {
    observed.length = 0;
    triggerResize = null;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      sizedRect(300, 120),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("measures the container once it is rendered", () => {
    render(<Panel configured />);
    expect(screen.getByTestId("root")).toHaveTextContent("300x120");
  });

  it("attaches to a container that only appears on a later render", () => {
    const { rerender } = render(<Panel configured={false} />);
    expect(observed).toHaveLength(0);

    rerender(<Panel configured />);

    expect(observed).toHaveLength(1);
    expect(screen.getByTestId("root")).toHaveTextContent("300x120");
  });

  it("reports border-box sizes on resize, matching the initial measurement", () => {
    render(<Panel configured />);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      sizedRect(500, 240),
    );
    act(() => triggerResize?.());

    expect(screen.getByTestId("root")).toHaveTextContent("500x240");
  });
});
