import { LayoutGrid, type LucideIcon } from "lucide-react";
import { terminalTabLabel, terminalTabLifecycleText } from "@/features/terminals";
import { PANEL_TAB_KIND_RULES } from "./panel-tab-kinds";
import { browserTabPresentation } from "./session-panel-browser-tab-presentation";
import type { ResolvedPanelTab } from "./session-panel-layout";

/** A badge that tells who can use a browser tab. */
export type PanelTabBadge = "shared" | "agent";

export type PanelTabPresentation = {
  label: string;
  icon: LucideIcon;
  /** A page favicon as a data URL. The tab shows it in place of the icon. */
  iconUrl: string | null;
  ariaLabel: string;
  /** Text that the tooltip always shows under the label, such as the full page URL. */
  tooltip: string | null;
  badge: PanelTabBadge | null;
  /** An agent acts on the page now. */
  isAgentActive: boolean;
  /** The page waits for an answer from the user, such as a dialog or a permission request. */
  hasPrompts: boolean;
};

export const NEW_TAB_LABEL = "New tab";

export const PANEL_TAB_BADGE_LABELS = {
  shared: "Shared",
  agent: "Agent",
} satisfies Record<PanelTabBadge, string>;

export const panelTabPresentation = (tab: ResolvedPanelTab): PanelTabPresentation => {
  if (tab.kind === "new_tab") return plainPresentation(NEW_TAB_LABEL, LayoutGrid);
  if (tab.kind === "terminal") {
    const label = terminalTabLabel(tab.terminal);
    return plainPresentation(
      label,
      PANEL_TAB_KIND_RULES.terminal.icon,
      `${label}, ${terminalTabLifecycleText(tab.terminal)}`,
    );
  }
  if (tab.kind === "browser") return browserTabPresentation(tab);
  const rule = PANEL_TAB_KIND_RULES[tab.kind];
  return plainPresentation(rule.label, rule.icon);
};

const plainPresentation = (
  label: string,
  icon: LucideIcon,
  ariaLabel: string = label,
): PanelTabPresentation => ({
  label,
  icon,
  iconUrl: null,
  ariaLabel,
  tooltip: null,
  badge: null,
  isAgentActive: false,
  hasPrompts: false,
});
