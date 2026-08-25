import { registerPanel } from "./registry";
import {
  gaugePanelDefinition,
  logPanelDefinition,
  brokerStatsPanelDefinition,
  buttonPanelDefinition,
  togglePanelDefinition,
  inputPanelDefinition,
  cronPanelDefinition,
  textPanelDefinition,
  separatorPanelDefinition,
  imagePanelDefinition,
} from "./definitions";

// Register all built-in panels
registerPanel(gaugePanelDefinition);
registerPanel(logPanelDefinition);
registerPanel(brokerStatsPanelDefinition);
registerPanel(buttonPanelDefinition);
registerPanel(togglePanelDefinition);
registerPanel(inputPanelDefinition);
registerPanel(cronPanelDefinition);
registerPanel(textPanelDefinition);
registerPanel(separatorPanelDefinition);
registerPanel(imagePanelDefinition);

export * from "./types";
export * from "./registry";
export * from "./definitions";
export * from "./TogglePanel";
export * from "./toggleUtils";
export { default as PanelPreviewCard } from "./PanelPreviewCard";
export { default as PanelEmptyState } from "./PanelEmptyState";
export { default as PanelModalFrame } from "./PanelModalFrame";
