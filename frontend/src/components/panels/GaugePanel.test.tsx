import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GaugePanel from "./GaugePanel";
import { parseGaugePayload } from "./gaugeUtils";

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

function resolveAsync<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), 1);
  });
}

describe("parseGaugePayload", () => {
  it("handles raw numeric payloads and strings", () => {
    expect(parseGaugePayload("23.5")).toEqual({
      parsedValue: 23.5,
      dataType: "number",
      raw: "23.5",
    });

    expect(parseGaugePayload("hello world")).toEqual({
      parsedValue: "hello world",
      dataType: "string",
      raw: "hello world",
    });
  });

  it("handles boolean strings and raw booleans", () => {
    expect(parseGaugePayload("true")).toEqual({
      parsedValue: true,
      dataType: "boolean",
      raw: "true",
    });

    expect(parseGaugePayload("OFF")).toEqual({
      parsedValue: false,
      dataType: "boolean",
      raw: "OFF",
    });
  });

  it("extracts values from JSON objects using valueKey or auto-detect", () => {
    expect(parseGaugePayload('{"temp": 28.4, "unit": "C"}', "temp")).toEqual({
      parsedValue: 28.4,
      dataType: "number",
      raw: '{"temp": 28.4, "unit": "C"}',
    });

    expect(parseGaugePayload('{"val": true}')).toEqual({
      parsedValue: true,
      dataType: "boolean",
      raw: '{"val": true}',
    });
  });
});

describe("GaugePanel", () => {
  beforeEach(() => {
    subscribeMock.mockReset();
    getExplorerHistoryMock.mockReset();
    onMessageHandler = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders empty state when no topic is configured", () => {
    render(<GaugePanel panelId="p1" brokerId="b1" config={{}} />);
    expect(screen.getByText("No Topic Configured")).toBeInTheDocument();
  });

  it("loads history and displays last known numeric value with unit", async () => {
    getExplorerHistoryMock.mockImplementation(() =>
      resolveAsync([
        {
          id: 1,
          broker_id: "b1",
          topic: "sensor/temp",
          payload: "24.5",
          timestamp: "2026-05-21T12:13:14.000Z",
        },
      ]),
    );

    render(
      <GaugePanel
        panelId="p1"
        brokerId="b1"
        config={{ topic: "sensor/temp", unit: "°C", min: 0, max: 50 }}
      />,
    );

    expect(await screen.findByText("24.5")).toBeInTheDocument();
    expect(screen.getByText("°C")).toBeInTheDocument();
    expect(screen.getByText("history")).toBeInTheDocument();
  });

  it("updates live value from websocket for boolean state", async () => {
    getExplorerHistoryMock.mockResolvedValue([]);

    render(
      <GaugePanel
        panelId="p1"
        brokerId="b1"
        config={{ topic: "device/status" }}
      />,
    );

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalled();
    });

    await act(async () => {
      onMessageHandler?.(
        JSON.stringify({
          topic: "device/status",
          payload: "ON",
          timestamp: "2026-05-21T14:15:16.000Z",
        }),
      );
    });

    expect(screen.getByText("ON")).toBeInTheDocument();
    expect(screen.queryByText("history")).not.toBeInTheDocument();
  });
});
