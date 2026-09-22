import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import BrokerTopicCard from "./BrokerTopicCard";
import type { BrokerStatus } from "../../../hooks/useBrokers";

afterEach(cleanup);

const mockBrokers: BrokerStatus[] = [
  {
    id: "broker-1",
    name: "Main Broker",
    is_enabled: true,
    status: "connected",
  },
  {
    id: "broker-2",
    name: "Secondary Broker",
    is_enabled: true,
    status: "disconnected",
  },
];

describe("BrokerTopicCard", () => {
  it("renders as a collapsible disclosure card with default 'Broker & Topic' title open by default", () => {
    render(
      <BrokerTopicCard
        brokers={mockBrokers}
        brokerId="broker-1"
        onBrokerChange={() => {}}
        topic="living-room/lamp"
        onTopicChange={() => {}}
      />,
    );

    // Header elements
    expect(screen.getByText("Broker & Topic")).toBeInTheDocument();
    expect(screen.getByText(/Main Broker : living-room\/lamp/)).toBeInTheDocument();

    // Connected status dot should have bg-success
    const greenDot = document.querySelector(".w-1\\.5.h-1\\.5.bg-success");
    expect(greenDot).toBeInTheDocument();

    // Fields should be visible
    expect(screen.getByRole("textbox", { name: "Topic" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Broker" })).toBeInTheDocument();
  });

  it("renders red dot for disconnected broker status", () => {
    render(
      <BrokerTopicCard
        title="Publishes to"
        brokers={mockBrokers}
        brokerId="broker-2"
        onBrokerChange={() => {}}
        topic="living-room/lamp"
        onTopicChange={() => {}}
      />,
    );

    const redDot = document.querySelector(".w-1\\.5.h-1\\.5.bg-error");
    expect(redDot).toBeInTheDocument();
  });


  it("toggles collapse and expand on header click", async () => {
    render(
      <BrokerTopicCard
        brokers={mockBrokers}
        brokerId="broker-1"
        onBrokerChange={() => {}}
        topic="living-room/lamp"
        onTopicChange={() => {}}
      />,
    );

    const toggleButton = screen.getByRole("button", { name: /Broker & Topic/ });
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");

    // Click to collapse
    await userEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Topic" })).toBeNull();

    // Click to expand again
    await userEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Topic" })).toBeInTheDocument();
  });

  it("respects defaultOpen=false", () => {
    render(
      <BrokerTopicCard
        brokers={mockBrokers}
        brokerId="broker-1"
        onBrokerChange={() => {}}
        topic="sensors/temp"
        onTopicChange={() => {}}
        defaultOpen={false}
      />,
    );

    const toggleButton = screen.getByRole("button", { name: /Broker & Topic/ });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "Topic" })).toBeNull();
  });

  it("renders bare mode without disclosure card wrapper", () => {
    render(
      <BrokerTopicCard
        bare
        brokers={mockBrokers}
        brokerId="broker-1"
        onBrokerChange={() => {}}
        topic="sensors/temp"
        onTopicChange={() => {}}
      />,
    );

    // No disclosure toggle button
    expect(screen.queryByRole("button", { name: /Broker/ })).toBeNull();
    // But the fields exist
    expect(screen.getByRole("textbox", { name: "Topic" })).toBeInTheDocument();
  });

  it("displays fallback message when no topic is configured", () => {
    render(
      <BrokerTopicCard
        title="Target"
        brokers={mockBrokers}
        brokerId="broker-1"
        onBrokerChange={() => {}}
        topic=""
        onTopicChange={() => {}}
      />,
    );

    expect(screen.getByText("No topic configured")).toBeInTheDocument();
  });
});
