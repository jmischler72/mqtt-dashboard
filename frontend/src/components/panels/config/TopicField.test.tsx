import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TopicField from "./TopicField";

afterEach(cleanup);

describe("TopicField", () => {
  it("lists a comma-separated topic per chip", () => {
    render(<TopicField value="a/one, a/two, a/three" onChange={() => {}} />);

    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
  });

  it("drops just the topic whose chip was closed", async () => {
    const onChange = vi.fn();
    render(<TopicField value="a/one, a/two, a/three" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove a/two" }));

    expect(onChange).toHaveBeenCalledWith("a/one, a/three");
  });

  it("removes by position, so a repeated topic loses one copy", async () => {
    const onChange = vi.fn();
    render(<TopicField value="a/one, a/two, a/one" onChange={onChange} />);

    await userEvent.click(
      screen.getAllByRole("button", { name: "Remove a/one" })[0],
    );

    expect(onChange).toHaveBeenCalledWith("a/two, a/one");
  });

  it("draws no chips for a single topic", () => {
    render(<TopicField value="a/one" onChange={() => {}} />);

    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });
});
