import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogPanel from "./LogPanel";

const subscribeMock = vi.fn();
const getExplorerHistoryMock = vi.fn();
let onMessageHandler: ((data: string) => void) | null = null;

vi.mock("../../hooks/useWebSocket", () => ({
  useWebSocket: (options: { onMessage: (data: string) => void }) => {
    onMessageHandler = options.onMessage;
    return { subscribe: subscribeMock };
  },
}));

vi.mock("../../api/client", () => ({
  api: {
    getExplorerHistory: (...args: unknown[]) => getExplorerHistoryMock(...args),
  },
}));

function formatNumeric(date: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function resolveAsync<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), 1);
  });
}

describe("LogPanel", () => {
  beforeEach(() => {
    subscribeMock.mockReset();
    getExplorerHistoryMock.mockReset();
    onMessageHandler = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("uses websocket timestamp for live entries", async () => {
    getExplorerHistoryMock.mockResolvedValue([]);

    render(
      <LogPanel
        panelId="panel-1"
        brokerId="b1"
        config={{ topics: "a/b", maxMessages: 100, dateFormat: "full" }}
      />,
    );

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalled();
    });

    const liveTs = "2026-05-21T10:11:12.000Z";
    await act(async () => {
      onMessageHandler?.(
        JSON.stringify({
          topic: "a/b",
          payload: "live-payload",
          timestamp: liveTs,
        }),
      );
    });

    const expected = formatNumeric(new Date(liveTs));
    expect(screen.getByText("live-payload")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`\\[${expected}\\]`))).toBeInTheDocument();
  });

  it("reformats existing rows when dateFormat changes", async () => {
    getExplorerHistoryMock.mockImplementation(() =>
      resolveAsync([
      {
        id: 1,
        broker_id: "b1",
        topic: "a/b",
        payload: "history-payload",
        timestamp: "2026-05-21T12:13:14.000Z",
      },
      ]),
    );

    const { rerender } = render(
      <LogPanel
        panelId="panel-1"
        brokerId="b1"
        config={{ topics: "a/b", maxMessages: 100, dateFormat: "time" }}
      />,
    );

    expect(await screen.findByText("history-payload")).toBeInTheDocument();

    rerender(
      <LogPanel
        panelId="panel-1"
        brokerId="b1"
        config={{ topics: "a/b", maxMessages: 100, dateFormat: "full" }}
      />,
    );

    const expected = formatNumeric(new Date("2026-05-21T12:13:14.000Z"));
    expect(screen.getByText(new RegExp(`\\[${expected}\\]`))).toBeInTheDocument();
  });

  it("loads wildcard history including parent topic record", async () => {
    getExplorerHistoryMock.mockImplementation(() =>
      resolveAsync([
      {
        id: 1,
        broker_id: "b1",
        topic: "test/tetsgisf",
        payload: "parent-message",
        timestamp: "2026-05-21T12:13:14.000Z",
      },
      ]),
    );

    render(
      <LogPanel
        panelId="panel-1"
        brokerId="b1"
        config={{ topics: "test/tetsgisf/#", maxMessages: 100, dateFormat: "full" }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("parent-message")).toBeInTheDocument();
    });
    expect(getExplorerHistoryMock).toHaveBeenCalledWith("b1", "test/tetsgisf/#");
  });
});
