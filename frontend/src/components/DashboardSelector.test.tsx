import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardSelector, { type Dashboard } from "./DashboardSelector";

const dashboards: Dashboard[] = [
  { id: "dash-1", name: "Default Dashboard", created_at: "2026-01-01" },
  { id: "dash-2", name: "Second Dashboard", created_at: "2026-01-02" },
];

function renderSelector(onSwitch = vi.fn()) {
  render(
    <DashboardSelector
      dashboards={dashboards}
      activeDashboardId="dash-1"
      onSwitch={onSwitch}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return onSwitch;
}

describe("DashboardSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists dashboards and switches", () => {
    const onSwitch = renderSelector();

    fireEvent.click(screen.getByTitle("Dashboard options"));
    const list = within(screen.getByRole("list", { name: "Dashboards" }));

    expect(
      list.getByRole("menuitem", { name: "Default Dashboard" }),
    ).toBeInTheDocument();

    fireEvent.click(list.getByRole("menuitem", { name: "Second Dashboard" }));
    expect(onSwitch).toHaveBeenCalledWith("dash-2");
  });

  it("always exposes new, import, rename, export, duplicate and delete", () => {
    renderSelector();

    fireEvent.click(screen.getByTitle("Dashboard options"));

    expect(
      screen.getByRole("menuitem", { name: /New dashboard/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Import from file/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Rename/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Export/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Duplicate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Delete/i }),
    ).toBeInTheDocument();
  });

  it("filters the dashboard list by the search query", () => {
    renderSelector();

    fireEvent.click(screen.getByTitle("Dashboard options"));
    fireEvent.change(screen.getByPlaceholderText("Find a dashboard"), {
      target: { value: "second" },
    });

    const list = within(screen.getByRole("list", { name: "Dashboards" }));
    expect(
      list.getByRole("menuitem", { name: "Second Dashboard" }),
    ).toBeInTheDocument();
    expect(
      list.queryByRole("menuitem", { name: "Default Dashboard" }),
    ).not.toBeInTheDocument();
  });
});
