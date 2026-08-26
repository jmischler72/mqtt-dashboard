import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("hides the kebab menu when editMode is false", () => {
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

    expect(
      screen.getByRole("option", { name: "Default Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Second Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Dashboard options")).not.toBeInTheDocument();
  });

  it("exposes create, import, rename, export, and delete via the kebab menu when editMode is true", () => {
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

    expect(
      screen.getByRole("option", { name: "Default Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Second Dashboard" }),
    ).toBeInTheDocument();

    const kebab = screen.getByTitle("Dashboard options");
    expect(kebab).toBeInTheDocument();
    fireEvent.click(kebab);

    expect(
      screen.getByRole("button", { name: /Create new/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import from JSON/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Rename/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Export/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete/i }),
    ).toBeInTheDocument();
  });
});
