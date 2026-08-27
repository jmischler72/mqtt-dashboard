import { describe, it, expect } from "vitest";
import {
  DASHBOARD_TEMPLATES,
  templateToImportPayload,
} from "./dashboardTemplates";

const VALID_PANEL_TYPES = new Set([
  "button",
  "input",
  "log",
  "cron",
  "stats",
  "text",
  "separator",
  "image",
  "gauge",
  "toggle",
]);

describe("dashboardTemplates", () => {
  it("defines at least the core templates", () => {
    expect(DASHBOARD_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    const ids = DASHBOARD_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("home-automation");
    expect(ids).toContain("broker-monitoring");
    expect(ids).toContain("device-control");
    expect(ids).toContain("minimal-starter");
  });

  DASHBOARD_TEMPLATES.forEach((template) => {
    describe(`template: ${template.name} (${template.id})`, () => {
      it("has a valid name, description, and non-empty panels list", () => {
        expect(template.name.trim().length).toBeGreaterThan(0);
        expect(template.description.trim().length).toBeGreaterThan(0);
        expect(template.panels.length).toBeGreaterThan(0);
      });

      it("has valid panel properties and stays within 12-column grid", () => {
        template.panels.forEach((p) => {
          expect(VALID_PANEL_TYPES.has(p.panel_type)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.w).toBeGreaterThanOrEqual(1);
          expect(p.h).toBeGreaterThanOrEqual(1);
          expect(p.x + p.w).toBeLessThanOrEqual(12);
          expect(p.config_json).toBeDefined();
          expect(typeof p.config_json).toBe("object");
        });
      });

      it("has no overlapping panels on the grid", () => {
        const occupied = new Map();

        template.panels.forEach((p) => {
          for (let row = p.y; row < p.y + p.h; row++) {
            for (let col = p.x; col < p.x + p.w; col++) {
              const cell = `${col},${row}`;
              if (occupied.has(cell)) {
                throw new Error(
                  `Overlap in template "${template.name}" at cell (${col}, ${row}) between "${occupied.get(cell)}" and "${p.title}"`,
                );
              }
              occupied.set(cell, p.title);
            }
          }
        });
      });

      it("converts cleanly to an import payload without broker_id", () => {
        const payload = templateToImportPayload(template);
        expect(payload.name).toBe(template.name);
        expect(payload.panels.length).toBe(template.panels.length);
        payload.panels.forEach((p, idx) => {
          expect(p.title).toBe(template.panels[idx].title);
          expect(p.panel_type).toBe(template.panels[idx].panel_type);
          expect(p.x).toBe(template.panels[idx].x);
          expect(p.y).toBe(template.panels[idx].y);
          expect(p.w).toBe(template.panels[idx].w);
          expect(p.h).toBe(template.panels[idx].h);
          expect(p.broker_id).toBeUndefined();
        });
      });
    });
  });
});
