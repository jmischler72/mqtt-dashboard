import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PayloadBuilder from "./PayloadBuilder";
import { VALUE_TOKEN } from "../payloadShape";

afterEach(cleanup);

/** The builder wired to its own state, the way a config modal holds it. */
function Builder({
  initial = "",
  payloads,
  acceptsChip = true,
  mode = "write",
}: {
  initial?: string;
  payloads: string[];
  acceptsChip?: boolean;
  mode?: "write" | "read";
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PayloadBuilder
        mode={mode}
        value={value}
        onChange={setValue}
        acceptsChip={acceptsChip}
        brokerId="b1"
        topic="home/lamp"
        history={{
          messages: payloads.map((payload) => ({ payload, ago: "2s" })),
          loading: false,
        }}
      />
      <output data-testid="template">{value}</output>
    </>
  );
}

/** Open the history disclosure and take the first message in it. */
function useFirstMessage() {
  fireEvent.click(screen.getByRole("button", { name: /show \d/ }));
  fireEvent.click(
    screen.getAllByRole("button", { name: /^use this message/ })[0],
  );
}

const template = () => screen.getByTestId("template").textContent;

describe("starting from a message", () => {
  it("marks the value, not a digit inside the key naming it", () => {
    // `relay2` is a field name; the reading is 21.5. Marking the key's digit
    // builds a shape that reads 2 forever, and the preview calls it a fit.
    render(<Builder payloads={['{"relay2":21.5}']} />);
    useFirstMessage();
    expect(template()).toBe(`{"relay2":${VALUE_TOKEN}}`);
  });

  it("marks the number at the offset it was found, not its first spelling", () => {
    // The `1` of `ch1` appears before the value that repeats it
    render(<Builder payloads={['{"ch1":{"v":1}}']} />);
    useFirstMessage();
    expect(template()).toBe(`{"ch1":{"v":${VALUE_TOKEN}}}`);
  });

  it("steps over a number inside a value the device quotes", () => {
    // A timestamp beside the reading is the commonest thing in MQTT JSON
    render(
      <Builder payloads={['{"ts":"2026-08-31T14:32:07Z","temp":21.5}']} />,
    );
    useFirstMessage();
    expect(template()).toBe(
      `{"ts":"2026-08-31T14:32:07Z","temp":${VALUE_TOKEN}}`,
    );
  });

  it("steps over a digit in an unquoted key too", () => {
    render(<Builder payloads={["{ch1:5}"]} />);
    useFirstMessage();
    expect(template()).toBe(`{ch1:${VALUE_TOKEN}}`);
  });

  it("marks inside the quotes when the device quotes its number", () => {
    render(<Builder payloads={['{"temp":"21.5"}']} />);
    useFirstMessage();
    expect(template()).toBe(`{"temp":"${VALUE_TOKEN}"}`);
  });

  it("finds the reading behind more text than the chip row shows", () => {
    render(
      <Builder payloads={['{"a":"w","b":"x","c":"y","d":"z","temp":21.5}']} />,
    );
    useFirstMessage();
    expect(template()).toBe(
      `{"a":"w","b":"x","c":"y","d":"z","temp":${VALUE_TOKEN}}`,
    );
  });

  it("marks the first number of a plain payload", () => {
    render(<Builder payloads={["21.5"]} />);
    useFirstMessage();
    expect(template()).toBe(VALUE_TOKEN);
  });

  it("takes a payload with no number to mark as it stands", () => {
    render(<Builder payloads={['{"cmd":"open"}']} />);
    useFirstMessage();
    expect(template()).toBe('{"cmd":"open"}');
  });

  it("fills the box verbatim for a panel that has no value to substitute", () => {
    render(<Builder payloads={['{"relay2":21.5}']} acceptsChip={false} />);
    useFirstMessage();
    expect(template()).toBe('{"relay2":21.5}');
  });
});

describe("a payload that spells the chip out", () => {
  it("allows multiple chips when the bytes typed in name a second", () => {
    render(<Builder initial={`{"a":${VALUE_TOKEN}}`} payloads={[]} />);
    const box = screen.getByRole("textbox");
    box.append(document.createTextNode(VALUE_TOKEN));
    fireEvent.input(box);
    expect(template()).toBe(`{"a":${VALUE_TOKEN}}${VALUE_TOKEN}`);
  });

  it("removes a chip when clicking its inline remove button", () => {
    render(<Builder initial={`{"a":${VALUE_TOKEN}}`} payloads={[]} />);
    const box = screen.getByRole("textbox");
    const removeBtn = box.querySelector("[data-remove-token]");
    expect(removeBtn).toBeTruthy();
    fireEvent.mouseDown(removeBtn!);
    expect(template()).toBe('{"a":}');
  });

  it("restores the replaced literal when removing the chip", () => {
    render(<Builder initial='{"temp":21.5}' payloads={[]} />);
    // Click the detected literal "21.5"
    fireEvent.click(screen.getByRole("button", { name: /21\.5/ }));
    expect(template()).toBe(`{"temp":${VALUE_TOKEN}}`);

    // Click the inline remove button on the chip
    const box = screen.getByRole("textbox");
    const removeBtn = box.querySelector("[data-remove-token]");
    expect(removeBtn).toBeTruthy();
    fireEvent.mouseDown(removeBtn!);

    // The literal is restored and remains detected
    expect(template()).toBe('{"temp":21.5}');
    expect(screen.getByRole("button", { name: /21\.5/ })).toBeTruthy();
  });

  it("leaves those characters alone for a panel that publishes them", () => {
    render(<Builder initial="" payloads={[]} acceptsChip={false} />);
    const box = screen.getByRole("textbox");
    box.append(document.createTextNode(`{"cmd":"${VALUE_TOKEN}"}`));
    fireEvent.input(box);
    expect(template()).toBe(`{"cmd":"${VALUE_TOKEN}"}`);
    // …and they are text the caret can get into, not an atomic chip
    expect(box.querySelector("[data-value-token]")).toBeNull();
  });
});

describe("the literals offered as one-tap chip targets", () => {
  it("offers a boolean value rather than the whole message", () => {
    // The payload has no quoted value and no number: the fallback that offers
    // a lone `ON` must not offer this whole document and collapse it.
    render(<Builder initial='{"cmd":true}' payloads={[]} />);
    expect(screen.getByRole("button", { name: "true" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: '{"cmd":true}' })).toBeNull();
  });

  it("still offers a lone word, which is the whole payload", () => {
    render(<Builder initial="RESET" payloads={[]} />);
    expect(screen.getByRole("button", { name: "RESET" })).toBeTruthy();
  });

  it("renders custom available tokens buttons and inserts them", () => {
    const customTokens = [
      { name: "value", token: "{value}", label: "value" },
      { name: "topic", token: "{topic}", label: "topic" },
      { name: "timestamp", token: "{timestamp}", label: "timestamp" },
    ];
    function CustomBuilder() {
      const [value, setValue] = useState('{"state":');
      return (
        <>
          <PayloadBuilder
            mode="write"
            value={value}
            onChange={setValue}
            acceptsChip={true}
            availableTokens={customTokens}
            brokerId="b1"
            topic="home/lamp"
          />
          <output data-testid="custom-template">{value}</output>
        </>
      );
    }

    render(<CustomBuilder />);
    // Open secondary tokens dropdown
    const menuTrigger = screen.getByRole("button", { name: "Insert context tokens" });
    expect(menuTrigger).toBeTruthy();
    fireEvent.click(menuTrigger);

    const topicBtn = screen.getByRole("button", { name: "topic" });
    expect(topicBtn).toBeTruthy();
    const tsBtn = screen.getByRole("button", { name: "timestamp" });
    expect(tsBtn).toBeTruthy();

    fireEvent.mouseDown(topicBtn);
    expect(screen.getByTestId("custom-template").textContent).toBe('{"state":{topic}');
  });

  it("renders top 2 literals inline and places extra literals in an overflow dropdown", () => {
    // 4 literals: temp, hum, pres, bat
    const initial = '{"temp":21.5,"hum":55,"pres":1013,"bat":98}';
    render(<Builder initial={initial} payloads={[]} />);

    // Top 2 literals should be inline badges
    expect(screen.getByRole("button", { name: "21.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "55" })).toBeTruthy();

    // Remaining 2 should be in overflow dropdown (+2 more)
    const overflowBtn = screen.getByRole("button", { name: /\+2 more/ });
    expect(overflowBtn).toBeTruthy();

    // Open the overflow dropdown
    fireEvent.click(overflowBtn);

    // 1013 and 98 are accessible in the dropdown
    expect(screen.getByRole("button", { name: "1013" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "98" })).toBeTruthy();
  });

  it("proposes recommendations from history sample message even when editing an already saved template", () => {
    // Coming back to edit a saved Gauge panel where readTemplate already has {{value}}
    const savedTemplate = `{"temp":${VALUE_TOKEN},"hum":55}`;
    const recentPayload = '{"temp":21.5,"hum":55,"bat":98}';
    render(
      <Builder
        mode="read"
        initial={savedTemplate}
        payloads={[recentPayload]}
      />,
    );

    // Recommendations from the device payload are proposed: temp, hum!
    expect(screen.getByRole("button", { name: "21.5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "55" })).toBeTruthy();
  });

  it("prevents multiple value tokens in read mode", () => {
    // In read mode (Gauge), when value already has a token, primary button indicates marked and doesn't add duplicate
    const initial = `{"temp":${VALUE_TOKEN}}`;
    render(<Builder mode="read" initial={initial} payloads={[]} />);

    const markedBtn = screen.getByRole("button", { name: /value marked/i });
    expect(markedBtn).toBeTruthy();
    fireEvent.mouseDown(markedBtn);

    // Template remains single token, not duplicated
    expect(template()).toBe(`{"temp":${VALUE_TOKEN}}`);
  });
});
