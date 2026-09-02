import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SliderPanel from "./SliderPanel";

const postMock = vi.fn();
const getExplorerHistoryMock = vi.fn();

vi.mock("../../hooks/useWebSocket", () => ({
  useWebSocket: () => ({ subscribe: vi.fn() }),
}));

vi.mock("../../api/client", () => ({
  api: {
    post: (...args: unknown[]) => postMock(...args),
    getExplorerHistory: (...args: unknown[]) => getExplorerHistoryMock(...args),
  },
}));

const config = { topic: "home/lamp/brightness", min: 0, max: 100, step: 1 };

function renderSlider() {
  render(<SliderPanel panelId="p1" brokerId="b1" config={config} />);
  return screen.getByRole("slider") as HTMLInputElement;
}

describe("SliderPanel publishing", () => {
  beforeEach(() => {
    postMock.mockReset().mockResolvedValue({});
    getExplorerHistoryMock.mockReset().mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("does not publish on a keyup that never moved the handle", () => {
    const slider = renderSlider();
    // Tabbing onto the slider releases the key over it, with no value change
    fireEvent.keyUp(slider, { key: "Tab" });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("publishes once the handle has actually moved", () => {
    const slider = renderSlider();
    fireEvent.change(slider, { target: { value: "40" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(
      "/api/publish",
      expect.objectContaining({ topic: "home/lamp/brightness", payload: "40" }),
    );
  });

  it("publishes a value typed into the readout", () => {
    render(<SliderPanel panelId="p1" brokerId="b1" config={config} />);

    fireEvent.doubleClick(screen.getByTitle(/Double-click/));
    const field = screen.getByLabelText("Value") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "72" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(postMock).toHaveBeenCalledWith(
      "/api/publish",
      expect.objectContaining({ payload: "72" }),
    );
  });

  it("snaps a typed value onto the range", () => {
    render(<SliderPanel panelId="p1" brokerId="b1" config={config} />);

    fireEvent.doubleClick(screen.getByTitle(/Double-click/));
    const field = screen.getByLabelText("Value") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "500" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(postMock).toHaveBeenCalledWith(
      "/api/publish",
      expect.objectContaining({ payload: "100" }),
    );
  });

  it("publishes nothing when the readout is cleared and confirmed", () => {
    render(<SliderPanel panelId="p1" brokerId="b1" config={config} />);

    fireEvent.doubleClick(screen.getByTitle(/Double-click/));
    const field = screen.getByLabelText("Value") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "Enter" });

    // Number("") is 0, which would have sent the range minimum
    expect(postMock).not.toHaveBeenCalled();
  });

  it("escape abandons what was typed", () => {
    render(<SliderPanel panelId="p1" brokerId="b1" config={config} />);

    fireEvent.doubleClick(screen.getByTitle(/Double-click/));
    const field = screen.getByLabelText("Value") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "72" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(postMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Value")).toBeNull();
  });

  it("offers no typing on a panel with no topic to publish to", () => {
    render(<SliderPanel panelId="p1" brokerId="b1" config={{}} />);
    expect(screen.queryByTitle(/Double-click/)).toBeNull();
  });

  it("decodes a state topic through the read shape with no separateRead flag", async () => {
    // A slider saved before the flag existed says "I read elsewhere" only by
    // carrying a state topic. It subscribes there either way, so it has to
    // decode there with the read shape too — the write shape names a different
    // field and would leave the handle stuck on "unknown".
    getExplorerHistoryMock.mockResolvedValue([
      { payload: '{"bri":42}', timestamp: "2026-01-01T00:00:00Z" },
    ]);

    render(
      <SliderPanel
        panelId="p1"
        brokerId="b1"
        config={{
          ...config,
          stateTopic: "home/lamp/state",
          payloadTemplate: '{"set":{value}}',
          readTemplate: '{"bri":{value}}',
        }}
      />,
    );

    expect(await screen.findByText("42")).toBeTruthy();
  });

  it("does not publish again on the blur that follows a committed move", () => {
    const slider = renderSlider();
    fireEvent.change(slider, { target: { value: "40" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    fireEvent.blur(slider);
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
