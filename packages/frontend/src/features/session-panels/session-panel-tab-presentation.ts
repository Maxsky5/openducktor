import { LayoutGrid, type LucideIcon } from "lucide-react";
import { terminalTabLabel, terminalTabLifecycleText } from "@/features/terminals";
import { PANEL_TAB_KIND_RULES } from "./panel-tab-kinds";
import type { ResolvedPanelTab } from "./session-panel-layout";

export type PanelTabPresentation = {
  label: string;
  icon: LucideIcon;
  ariaLabel: string;
};

export const NEW_TAB_LABEL = "New tab";

export const panelTabPresentation = (tab: ResolvedPanelTab): PanelTabPresentation => {
  if (tab.kind === "new_tab") {
    return {
      label: NEW_TAB_LABEL,
      icon: LayoutGrid,
      ariaLabel: NEW_TAB_LABEL,
    };
  }
  if (tab.kind === "terminal") {
    const label = terminalTabLabel(tab.terminal);
    return {
      label,
      icon: PANEL_TAB_KIND_RULES.terminal.icon,
      ariaLabel: `${label}, ${terminalTabLifecycleText(tab.terminal)}`,
    };
  }
  const rule = PANEL_TAB_KIND_RULES[tab.kind];
  return { label: rule.label, icon: rule.icon, ariaLabel: rule.label };
};
