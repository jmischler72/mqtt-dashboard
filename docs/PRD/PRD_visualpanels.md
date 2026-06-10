# Product Requirements Document (PRD): Custom Visual Dashboard Panels

## 1. Executive Summary

This project introduces **Visual Panels** (Image, Separator, Text) to the existing dashboard. These are non-functional, headerless components designed for annotation, organization, and aesthetic branding, fully integrated into the `react-grid-layout` system.

---

## 2. Technical Specifications & Features

### 2.1 Global Panel Behavior

- **Headerless:** Visual panels render without headers or settings icons in "View" mode.
- **Grid Integration:** Managed via `react-grid-layout`. All panels are resizable and draggable.
- **Dynamic Constraints:** \* Standard panels maintain `minW: 2, minH: 2`.
  - Separator panels are configured with `minW: 1, minH: 1` to allow for compact visual lines.
- **Configuration Access:** Each panel contains a "Gear" icon to open a unified configuration modal.

### 2.2 Text Panel

- **Input Method:** Markdown-based text entry.
- **UI/UX:** Modal-based editor (1/3 screen width) with a **Tabbed Switcher** (Edit/Preview).
- **Templates:** "Start with a template" button populates predefined Markdown and style defaults.
- **Styling:** Global panel-level styling for `Color`, `Font Size`, and `Alignment`.
- **Preview:** Renders Markdown with chosen styles, ensuring high-fidelity output.

### 2.3 Image Panel

- **Asset Management:** Supports local file uploads, remote URL fetching, and a "Preset" library.
- **Unified Storage:** All images (uploads and presets) are stored/scanned within the `/data/images/` directory.
- **Discovery:** The backend dynamically scans `/data/images/` to populate the Preset selection grid.

### 2.4 Separator Panel

- **Orientation:** Toggle between Horizontal and Vertical lines.
- **Styling:** Configurable thickness and color.

---

## 3. Configuration Modal Design

The modal acts as a consistent hub for all visual panel types:

- **Header:** Panel identification title.
- **Top Action Bar:** Includes template selection (for Text) and the Edit/Preview tab switcher.
- **Content Area:** Full-width editing area (Edit tab) and rendered result (Preview tab).
- **Settings Section:** Global controls (Color picker, Font size, etc.).
- **Footer:** Save/Cancel actions to commit changes to the dashboard config.

---

## 4. Implementation Priorities

- **Core Engine:** Implement headerless rendering and per-panel dynamic grid constraints.
- **Config Hub:** Build the modal shell, state management, and the `dashboard_config.json` schema.
- **Panel Logic:** \* Integrate `react-markdown` for the Text Panel.
  - Develop the backend file-scanning service for Image Presets.
  - Implement orientation/style logic for Separators.
- **Polish:** CSS styling for modal responsiveness and visual fidelity in the dashboard grid.
