import { registerPanel } from "./registry";
import {
  gaugePanelDefinition,
  logPanelDefinition,
  graphPanelDefinition,
  brokerStatsPanelDefinition,
  buttonPanelDefinition,
  inputPanelDefinition,
  cronPanelDefinition,
  togglePanelDefinition,
  sliderPanelDefinition,
  textPanelDefinition,
  separatorPanelDefinition,
  imagePanelDefinition,
} from "./definitions";

// Register all built-in panels
registerPanel(gaugePanelDefinition);
registerPanel(logPanelDefinition);
registerPanel(graphPanelDefinition);
registerPanel(brokerStatsPanelDefinition);
registerPanel(buttonPanelDefinition);
registerPanel(inputPanelDefinition);
registerPanel(cronPanelDefinition);
registerPanel(togglePanelDefinition);
registerPanel(sliderPanelDefinition);
registerPanel(textPanelDefinition);
registerPanel(separatorPanelDefinition);
registerPanel(imagePanelDefinition);

export * from "./types";
export * from "./registry";
export * from "./definitions";
export { default as PanelPreviewCard } from "./PanelPreviewCard";
export { default as PanelEmptyState } from "./PanelEmptyState";
export * from "./config";
