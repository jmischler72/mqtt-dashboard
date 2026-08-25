import { registerPanel } from "./registry";
import {
  gaugePanelDefinition,
  logPanelDefinition,
  brokerStatsPanelDefinition,
  buttonPanelDefinition,
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
registerPanel(inputPanelDefinition);
registerPanel(cronPanelDefinition);
registerPanel(textPanelDefinition);
registerPanel(separatorPanelDefinition);
registerPanel(imagePanelDefinition);

export * from "./types";
export * from "./registry";
export * from "./definitions";
export { default as PanelPreviewCard } from "./PanelPreviewCard";
export { default as PanelEmptyState } from "./PanelEmptyState";

