import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MdSpeed } from "react-icons/md";
import {
  getAllPanels,
  getPanelDefinition,
  getPanelsByCategory,
  registerPanel,
  defaultValidateWarning,
  defaultBuildHeaderMeta,
  defaultResolvePickedTopic,
  PanelPreviewCard,
  type PanelDefinition,
} from "./index";

describe("Panel Registry", () => {
  it("registers all 9 built-in panels by default", () => {
    const panels = getAllPanels();
    expect(panels.length).toBeGreaterThanOrEqual(9);

    const types = panels.map((p) => p.type);
    expect(types).toContain("gauge");
    expect(types).toContain("log");
    expect(types).toContain("stats");
    expect(types).toContain("button");
    expect(types).toContain("input");
    expect(types).toContain("cron");
    expect(types).toContain("text");
    expect(types).toContain("separator");
    expect(types).toContain("image");
  });

  it("retrieves panels by category correctly", () => {
    const monitors = getPanelsByCategory("monitor").map((p) => p.type);
    expect(monitors).toEqual(expect.arrayContaining(["gauge", "log", "stats"]));
    expect(monitors).not.toContain("button");
    expect(monitors).not.toContain("text");

    const controls = getPanelsByCategory("control").map((p) => p.type);
    expect(controls).toEqual(
      expect.arrayContaining(["button", "input", "cron"]),
    );
    expect(controls).not.toContain("gauge");
    expect(controls).not.toContain("image");

    const visuals = getPanelsByCategory("visual").map((p) => p.type);
    expect(visuals).toEqual(
      expect.arrayContaining(["text", "separator", "image"]),
    );
    expect(visuals).not.toContain("stats");
    expect(visuals).not.toContain("button");
  });

  it("allows registering and retrieving custom community panels", () => {
    const customPanel: PanelDefinition = {
      type: "community-solar-tracker",
      label: "Solar Tracker",
      category: "monitor",
      icon: MdSpeed,
      description: "Monitors solar inverter output and battery storage level",
      author: "@solardev",
      version: "1.2.0",
      repository: "https://github.com/solardev/solar-tracker",
      Component: () => null,
      ConfigModal: () => null,
    };

    registerPanel(customPanel);

    const retrieved = getPanelDefinition("community-solar-tracker");
    expect(retrieved).toBeDefined();
    expect(retrieved?.label).toBe("Solar Tracker");
    expect(retrieved?.author).toBe("@solardev");
    expect(retrieved?.version).toBe("1.2.0");
    expect(getPanelsByCategory("monitor")).toContainEqual(customPanel);
  });
});

describe("Registry Helper: defaultValidateWarning", () => {
  const gaugeDef = getPanelDefinition("gauge")!;
  const buttonDef = getPanelDefinition("button")!;
  const textDef = getPanelDefinition("text")!;

  it("returns null for visual panels", () => {
    expect(defaultValidateWarning(textDef, {})).toBeNull();
    expect(defaultValidateWarning(textDef, { topic: "" })).toBeNull();
  });

  it("returns 'No topic configured' if topic is missing for non-visual panels", () => {
    expect(defaultValidateWarning(gaugeDef, {})).toBe("No topic configured");
    expect(defaultValidateWarning(gaugeDef, { topic: "  " })).toBe(
      "No topic configured",
    );
    expect(defaultValidateWarning(buttonDef, {})).toBe("No topic configured");
  });

  it("allows wildcards on monitor panels", () => {
    expect(defaultValidateWarning(gaugeDef, { topic: "sensors/+/temp" })).toBeNull();
    expect(defaultValidateWarning(gaugeDef, { topic: "#" })).toBeNull();
  });

  it("warns about wildcards on control panels", () => {
    expect(defaultValidateWarning(buttonDef, { topic: "devices/+/set" })).toBe(
      "Cannot publish to wildcard topics (+ or #)",
    );
    expect(defaultValidateWarning(buttonDef, { topic: "#" })).toBe(
      "Cannot publish to wildcard topics (+ or #)",
    );
    expect(defaultValidateWarning(buttonDef, { topic: "devices/light1/set" })).toBeNull();
  });
});

describe("Registry Helper: defaultBuildHeaderMeta", () => {
  const buttonDef = getPanelDefinition("button")!;
  const logDef = getPanelDefinition("log")!;
  const textDef = getPanelDefinition("text")!;

  it("formats single topic summary", () => {
    const meta = defaultBuildHeaderMeta(buttonDef, { topic: "home/living/temp" });
    expect(meta.topicSummary).toBe("home/living/temp");
  });

  it("formats wildcard # as 'all topics'", () => {
    const meta = defaultBuildHeaderMeta(logDef, { topics: "#" });
    expect(meta.topicSummary).toBe("all topics");
  });

  it("formats multi-topic lists", () => {
    const meta = defaultBuildHeaderMeta(logDef, {
      topics: "sensor/temp, sensor/humidity, sensor/pressure",
    });
    expect(meta.topicSummary).toBe("3 configured");
    expect(meta.topicDetail).toBe("sensor/temp, sensor/humidity, sensor/pressure");
  });

  it("includes payload preview for control category panels", () => {
    const meta = defaultBuildHeaderMeta(buttonDef, {
      topic: "light/toggle",
      payload: '{"state":"ON"}',
    });
    expect(meta.payloadPreview).toBe('{"state":"ON"}');
  });

  it("omits payload preview for monitor/visual panels", () => {
    const meta = defaultBuildHeaderMeta(textDef, {
      payload: '{"state":"ON"}',
    });
    expect(meta.payloadPreview).toBeUndefined();
  });
});

describe("Registry Helper: defaultResolvePickedTopic & Custom Resolve", () => {
  it("replaces topic when existing topic is empty", () => {
    expect(defaultResolvePickedTopic("", "sensor/temp")).toBe("sensor/temp");
    expect(defaultResolvePickedTopic(undefined, "sensor/temp")).toBe("sensor/temp");
  });

  it("merges multiple topics uniquely", () => {
    expect(
      defaultResolvePickedTopic("sensor/a, sensor/b", "sensor/c"),
    ).toBe("sensor/a, sensor/b, sensor/c");
  });

  it("does not duplicate already existing topic in list", () => {
    expect(
      defaultResolvePickedTopic("sensor/a, sensor/b", "sensor/a"),
    ).toBe("sensor/a, sensor/b");
  });

  it("gauge custom resolvePickedTopic replaces rather than merging", () => {
    const gaugeDef = getPanelDefinition("gauge")!;
    expect(gaugeDef.resolvePickedTopic?.("sensor/old", "sensor/new")).toBe(
      "sensor/new",
    );
  });
});

describe("Separator layout constraints", () => {
  const sepDef = getPanelDefinition("separator")!;

  it("applies horizontal height constraint", () => {
    const constraints = sepDef.getMinMaxConstraints?.({ orientation: "horizontal" });
    expect(constraints).toEqual({ minW: 1, minH: 1, maxH: 1 });
  });

  it("applies vertical width constraint", () => {
    const constraints = sepDef.getMinMaxConstraints?.({ orientation: "vertical" });
    expect(constraints).toEqual({ minW: 1, minH: 1, maxW: 1 });
  });
});

describe("PanelPreviewCard", () => {
  it("renders custom visual mockup when definition has preview JSX", () => {
    const gaugeDef = getPanelDefinition("gauge")!;
    render(<PanelPreviewCard definition={gaugeDef} />);
    expect(screen.getByText("sensor/temp")).toBeInTheDocument();
    expect(screen.getByText("24°C")).toBeInTheDocument();
  });

  it("renders community info card when definition has no preview JSX", () => {
    const communityDef: PanelDefinition = {
      type: "community-temp-sensor",
      label: "Community Sensor",
      category: "monitor",
      icon: MdSpeed,
      description: "Ultra-fast live temperature and humidity monitor",
      author: "johndoe",
      version: "2.1.0",
      repository: "https://github.com/johndoe/sensor",
      Component: () => null,
      ConfigModal: () => null,
    };

    render(<PanelPreviewCard definition={communityDef} />);
    expect(screen.getByText("Community Sensor")).toBeInTheDocument();
    expect(screen.getByText("v2.1.0")).toBeInTheDocument();
    expect(
      screen.getByText("Ultra-fast live temperature and humidity monitor"),
    ).toBeInTheDocument();
    expect(screen.getByText("by johndoe")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});
