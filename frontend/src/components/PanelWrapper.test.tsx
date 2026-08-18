import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PanelWrapper from "./PanelWrapper";
import type { Panel } from "../pages/DashboardPage";

const putMock = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    put: (...args: unknown[]) => putMock(...args),
    delete: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    getExplorerHistory: vi.fn().mockResolvedValue([]),
    getActivity: vi.fn().mockResolvedValue({
      bucket_seconds: 1,
      buckets: [],
      total: 0,
      total_bytes: 0,
      topics: [],
    }),
  },
}));

const basePanel: Panel = {
  id: "panel-1",
  title: "Test Panel",
  panel_type: "button",
  x: 0,
  y: 0,
  w: 4,
  h: 4,
  broker_id: "broker-1",
  config_json: {
    topic: "sensors/temp",
    payload: '{"action":"on"}',
  },
};

const brokerStatuses = [
  {
    id: "broker-1",
    name: "Home Broker",
    status: "CONNECTED",
    is_enabled: true,
  },
];

function renderWithPanel(initialPanel: Panel = basePanel) {
  function Host() {
    const [panel, setPanel] = useState<Panel>(initialPanel);

    return (
      <MemoryRouter>
        <PanelWrapper
          panel={panel}
          editMode={false}
          brokerStatuses={brokerStatuses}
          activeDashboardId="dash-1"
          onDelete={() => {}}
          onUpdate={(next) => setPanel(next)}
          onConfigModalChange={() => {}}
        />
      </MemoryRouter>
    );
  }

  return render(<Host />);
}

describe("PanelWrapper header metadata", () => {
  beforeEach(() => {
    putMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows broker and topic metadata on status-dot hover", async () => {
    renderWithPanel();

    const statusDots = screen.getAllByRole("button", {
      name: /broker status details/i,
    });
    fireEvent.mouseEnter(statusDots[statusDots.length - 1]);

    expect(await screen.findByText("Home Broker")).toBeInTheDocument();
    expect(screen.getByText("sensors/temp")).toBeInTheDocument();
  });

  it("pins metadata popover and persists pin state", async () => {
    putMock.mockResolvedValue({
      ...basePanel,
      config_json: {
        ...basePanel.config_json,
        header_meta_pinned: true,
      },
    });

    renderWithPanel();

    const statusDots = screen.getAllByRole("button", {
      name: /broker status details/i,
    });
    fireEvent.mouseEnter(statusDots[statusDots.length - 1]);
    fireEvent.click(
      await screen.findByRole("button", { name: /pin broker metadata/i }),
    );

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith("/api/layouts/panel-1", {
        config_json: {
          ...basePanel.config_json,
          header_meta_pinned: true,
        },
      });
    });

    fireEvent.mouseLeave(screen.getByTestId("panel-meta-anchor"));
    expect(screen.getByText("Home Broker")).toBeInTheDocument();
  });

  it("shows log topic count summary and detailed list", async () => {
    renderWithPanel({
      ...basePanel,
      panel_type: "log",
      config_json: {
        topics:
          "sensors/temp, sensors/humidity, sensors/pressure, alerts/system",
      },
    } as Panel);

    const statusDots = screen.getAllByRole("button", {
      name: /broker status details/i,
    });
    fireEvent.mouseEnter(statusDots[statusDots.length - 1]);

    const countSummary = await screen.findByText(/4 configured/i);
    expect(countSummary).toBeInTheDocument();

    fireEvent.mouseEnter(countSummary);
    expect(
      await screen.findByText(
        "sensors/temp, sensors/humidity, sensors/pressure, alerts/system",
      ),
    ).toBeInTheDocument();
  });

  it("shows 'all topics' for log panel when topic is '#'", async () => {
    renderWithPanel({
      ...basePanel,
      panel_type: "log",
      config_json: {
        topics: "#",
      },
    } as Panel);

    const statusDots = screen.getAllByRole("button", {
      name: /broker status details/i,
    });
    fireEvent.mouseEnter(statusDots[statusDots.length - 1]);

    expect(await screen.findByText("all topics")).toBeInTheDocument();
  });

  it("shows 'not configured' for stats panel when no topic is specified", async () => {
    renderWithPanel({
      ...basePanel,
      panel_type: "stats",
      config_json: {},
    } as Panel);

    const statusDots = screen.getAllByRole("button", {
      name: /broker status details/i,
    });
    fireEvent.mouseEnter(statusDots[statusDots.length - 1]);

    expect(await screen.findByText("not configured")).toBeInTheDocument();
  });

  it("shows 'all topics' for stats panel when topic is '#'", async () => {
    renderWithPanel({
      ...basePanel,
      panel_type: "stats",
      config_json: { topics: "#" },
    } as Panel);

    const statusDots = screen.getAllByRole("button", {
      name: /broker status details/i,
    });
    fireEvent.mouseEnter(statusDots[statusDots.length - 1]);

    expect(await screen.findByText("all topics")).toBeInTheDocument();
  });

  it("shows specific topic for stats panel when topic is configured", async () => {
    renderWithPanel({
      ...basePanel,
      panel_type: "stats",
      config_json: { topics: "sensors/#" },
    } as Panel);

    const statusDots = screen.getAllByRole("button", {
      name: /broker status details/i,
    });
    fireEvent.mouseEnter(statusDots[statusDots.length - 1]);

    expect(await screen.findByText("sensors/#")).toBeInTheDocument();
  });
});
