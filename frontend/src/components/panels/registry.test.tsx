import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MdSpeed } from "react-icons/md";
import {
  getAllPanels,
  getPanelDefinition,
  getPanelsByCategory,
  registerPanel,
  defaultValidateWarning,
  defaultValidateConfig,
  defaultCheckEmpty,
  defaultBuildHeaderMeta,
  defaultResolvePickedTopic,
  PanelPreviewCard,
  PanelEmptyState,
  PanelModalFrame,
  type PanelDefinition,
} from "./index";

afterEach(() => {
  cleanup();
});

describe("Slider header meta", () => {
  const slider = () => getPanelDefinition("slider");

  it("shows the payload, as the config modal does", () => {
    expect(
      slider()?.getHeaderMeta?.({ topic: "lamp", payloadTemplate: '{"b":◆}' })
        ?.payloadPreview,
    ).toBe('{"b":value}');
  });

  it("shows both shapes when the panel reads from elsewhere", () => {
    expect(
      slider()?.getHeaderMeta?.({
        topic: "lamp",
        payloadTemplate: "◆",
        separateRead: true,
        readTemplate: '{"bri":◆}',
      })?.payloadPreview,
    ).toBe('sends  value\nreads  {"bri":value}');
  });
});

describe("Panel Registry", () => {
  it("registers all 11 built-in panels by default", () => {
    const panels = getAllPanels();
    expect(panels.length).toBeGreaterThanOrEqual(11);

    const types = panels.map((p) => p.type);
    expect(types).toContain("gauge");
    expect(types).toContain("log");
    expect(types).toContain("stats");
    expect(types).toContain("button");
    expect(types).toContain("input");
    expect(types).toContain("cron");
    expect(types).toContain("toggle");
    expect(types).toContain("slider");
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
      expect.arrayContaining(["button", "input", "cron", "toggle", "slider"]),
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

describe("Registry Helper: defaultValidateConfig & defaultValidateWarning", () => {
  const gaugeDef = getPanelDefinition("gauge")!;
  const buttonDef = getPanelDefinition("button")!;
  const textDef = getPanelDefinition("text")!;

  it("returns valid for visual panels", () => {
    expect(defaultValidateConfig(textDef, {}).isValid).toBe(true);
    expect(defaultValidateWarning(textDef, {})).toBeNull();
  });

  it("returns error and warning if topic is missing for non-visual panels", () => {
    const res = defaultValidateConfig(gaugeDef, {});
    expect(res.isValid).toBe(false);
    expect(res.warning).toBe("No topic configured");
    expect(res.errors?.topic).toBe("Topic is required");
    expect(defaultValidateWarning(gaugeDef, {})).toBe("No topic configured");
  });

  it("allows wildcards on monitor panels", () => {
    const res = defaultValidateConfig(gaugeDef, { topic: "sensors/+/temp" });
    expect(res.isValid).toBe(true);
    expect(res.warning).toBeUndefined();
    expect(defaultValidateWarning(gaugeDef, { topic: "#" })).toBeNull();
  });

  it("warns and invalidates wildcards on control panels", () => {
    const res = defaultValidateConfig(buttonDef, { topic: "devices/+/set" });
    expect(res.isValid).toBe(false);
    expect(res.warning).toBe("Cannot publish to wildcard topics (+ or #)");
    expect(defaultValidateWarning(buttonDef, { topic: "devices/+/set" })).toBe(
      "Cannot publish to wildcard topics (+ or #)",
    );
  });

  it("respects custom validateConfig when provided", () => {
    const customDef: PanelDefinition = {
      type: "custom-validator",
      label: "Custom",
      category: "monitor",
      icon: MdSpeed,
      validateConfig: (cfg) => {
        if (!cfg.apiKey) {
          return {
            isValid: false,
            warning: "API Key required",
            errors: { apiKey: "Missing API Key" },
          };
        }
        return { isValid: true };
      },
      Component: () => null,
      ConfigModal: () => null,
    };

    expect(defaultValidateConfig(customDef, {}).isValid).toBe(false);
    expect(defaultValidateConfig(customDef, {}).warning).toBe(
      "API Key required",
    );
    expect(defaultValidateConfig(customDef, { apiKey: "secret" }).isValid).toBe(
      true,
    );
  });
});

describe("Registry Helper: defaultCheckEmpty", () => {
  const textDef = getPanelDefinition("text")!;
  const imageDef = getPanelDefinition("image")!;
  const inputDef = getPanelDefinition("input")!;
  const cronDef = getPanelDefinition("cron")!;
  const sepDef = getPanelDefinition("separator")!;

  it("detects empty state for unconfigured Text panel", () => {
    const empty = defaultCheckEmpty(textDef, {});
    expect(empty).toBeDefined();
    expect(empty?.message).toContain("Empty text panel");
    expect(empty?.actionLabel).toBe("Edit Text");

    expect(defaultCheckEmpty(textDef, { markdown: "# Hello" })).toBeNull();
  });

  it("detects empty state for unconfigured Image panel", () => {
    const empty = defaultCheckEmpty(imageDef, {});
    expect(empty).toBeDefined();
    expect(empty?.message).toContain("No image");
    expect(empty?.actionLabel).toBe("Choose Image");

    expect(
      defaultCheckEmpty(imageDef, { src: "https://example.com/logo.png" }),
    ).toBeNull();
  });

  it("detects empty state for unconfigured Input panel", () => {
    const empty = defaultCheckEmpty(inputDef, {});
    expect(empty).toBeDefined();
    expect(empty?.message).toContain("No topic configured");

    expect(
      defaultCheckEmpty(inputDef, { topic: "devices/command" }),
    ).toBeNull();
  });

  it("detects empty state for unconfigured Cron panel", () => {
    const empty = defaultCheckEmpty(cronDef, {});
    expect(empty).toBeDefined();
    expect(empty?.message).toContain("No schedule configured");

    expect(defaultCheckEmpty(cronDef, { cron_expr: "* * * * *" })).toBeNull();
  });

  it("separator panel is never considered empty", () => {
    expect(defaultCheckEmpty(sepDef, {})).toBeNull();
  });
});

describe("Registry Helper: defaultBuildHeaderMeta", () => {
  const buttonDef = getPanelDefinition("button")!;
  const logDef = getPanelDefinition("log")!;
  const textDef = getPanelDefinition("text")!;

  it("formats single topic summary", () => {
    const meta = defaultBuildHeaderMeta(buttonDef, {
      topic: "home/living/temp",
    });
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
    expect(meta.topicDetail).toBe(
      "sensor/temp, sensor/humidity, sensor/pressure",
    );
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
    expect(defaultResolvePickedTopic(undefined, "sensor/temp")).toBe(
      "sensor/temp",
    );
  });

  it("merges multiple topics uniquely", () => {
    expect(defaultResolvePickedTopic("sensor/a, sensor/b", "sensor/c")).toBe(
      "sensor/a, sensor/b, sensor/c",
    );
  });

  it("does not duplicate already existing topic in list", () => {
    expect(defaultResolvePickedTopic("sensor/a, sensor/b", "sensor/a")).toBe(
      "sensor/a, sensor/b",
    );
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
    const constraints = sepDef.getMinMaxConstraints?.({
      orientation: "horizontal",
    });
    expect(constraints).toEqual({ minW: 1, minH: 1, maxH: 1 });
  });

  it("applies vertical width constraint", () => {
    const constraints = sepDef.getMinMaxConstraints?.({
      orientation: "vertical",
    });
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

describe("PanelEmptyState", () => {
  it("renders message and action button in editMode", () => {
    const onConfigure = vi.fn();
    render(
      <PanelEmptyState
        message="No image chosen"
        actionLabel="Choose Image"
        onConfigure={onConfigure}
        editMode={true}
      />,
    );

    expect(screen.getByText("No image chosen")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /choose image/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onConfigure).toHaveBeenCalledTimes(1);
  });

  it("hides action button in viewMode", () => {
    render(
      <PanelEmptyState
        message="No image chosen"
        actionLabel="Choose Image"
        onConfigure={() => {}}
        editMode={false}
      />,
    );

    expect(screen.getByText("No image chosen")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /choose image/i }),
    ).not.toBeInTheDocument();
  });
});

describe("PanelModalFrame", () => {
  it("renders title, content, and handles save/close events", () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <PanelModalFrame
        title="Test Modal"
        onClose={onClose}
        onSave={onSave}
        headerAction={<button type="button">Action</button>}
      >
        <div>Modal Body Content</div>
      </PanelModalFrame>,
    );

    expect(screen.getByText("Test Modal")).toBeInTheDocument();
    expect(screen.getByText("Modal Body Content")).toBeInTheDocument();
    expect(screen.getByText("Action")).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledTimes(1);

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles Escape key dismissal", () => {
    const onClose = vi.fn();
    render(
      <PanelModalFrame title="Escape Test" onClose={onClose}>
        <div>Body</div>
      </PanelModalFrame>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables save button when saveDisabled is true", () => {
    const onSave = vi.fn();
    render(
      <PanelModalFrame
        title="Disabled Save"
        onClose={() => {}}
        onSave={onSave}
        saveDisabled={true}
      >
        <div>Body</div>
      </PanelModalFrame>,
    );

    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();
    fireEvent.click(saveBtn);
    expect(onSave).not.toHaveBeenCalled();
  });
});
