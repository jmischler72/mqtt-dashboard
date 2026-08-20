import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardSelector, { type Dashboard } from "./DashboardSelector";

const dashboards: Dashboard[] = [
  { id: "dash-1", name: "Default Dashboard", created_at: "2026-01-01" },
  { id: "dash-2", name: "Second Dashboard", created_at: "2026-01-02" },
];

describe("DashboardSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render create and load (import) options when editMode is false", () => {
    render(
      <DashboardSelector
        dashboards={dashboards}
        activeDashboardId="dash-1"
        editMode={false}
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "Default Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Second Dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Create New Dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Import from JSON/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Dashboard options")).not.toBeInTheDocument();
  });

  it("renders create and load (import) options when editMode is true", () => {
    render(
      <DashboardSelector
        dashboards={dashboards}
        activeDashboardId="dash-1"
        editMode={true}
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "Default Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Second Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Create New Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Import from JSON/i })).toBeInTheDocument();
    expect(screen.getByTitle("Dashboard options")).toBeInTheDocument();
  });
});
