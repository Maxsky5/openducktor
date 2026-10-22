import { isBrowserNavigableUrl } from "@openducktor/contracts";
import { AppWindow } from "lucide-react";
import { PANEL_TAB_KIND_RULES } from "./panel-tab-kinds";
import type { ResolvedBrowserTab } from "./session-panel-layout";
import type { PanelTabBadge, PanelTabPresentation } from "./session-panel-tab-presentation";

const POPUP_WINDOW_TEXT = "The page is open in a popup window.";
const BLANK_PAGE_LABEL = "Blank page";

const BADGE_DESCRIPTIONS = {
  shared: "shared with agents",
  agent: "agent tab",
} satisfies Record<PanelTabBadge, string>;

/** The page title, or the host before the page has a title. */
export const browserPageLabel = (browserTab: ResolvedBrowserTab): string => {
  const title = browserTab.tab?.title?.trim();
  if (title) return title;
  const url = browserPageUrl(browserTab);
  if (url === null) return BLANK_PAGE_LABEL;
  return URL.parse(url)?.host || url;
};

/** The http or https URL of the page, or null for a blank page. */
const browserPageUrl = ({ tab }: ResolvedBrowserTab): string | null =>
  tab && isBrowserNavigableUrl(tab.url) ? tab.url : null;

const browserTabBadge = ({ tab }: ResolvedBrowserTab): PanelTabBadge | null => {
  if (tab?.createdBy === "agent") return "agent";
  if (tab?.shared) return "shared";
  return null;
};

/** The label, icon, badge, and marks of a browser tab. */
export const browserTabPresentation = (browserTab: ResolvedBrowserTab): PanelTabPresentation => {
  const { tab } = browserTab;
  const label = browserPageLabel(browserTab);
  const url = browserPageUrl(browserTab);
  const badge = browserTabBadge(browserTab);
  const isPopupWindow = tab?.surface === "popup_window";
  const isAgentActive = tab?.agentActive ?? false;
  const ariaParts = [
    label,
    badge ? BADGE_DESCRIPTIONS[badge] : null,
    isPopupWindow ? "open in a popup window" : null,
    isAgentActive ? "an agent uses the page" : null,
  ];
  return {
    label,
    icon: isPopupWindow ? AppWindow : PANEL_TAB_KIND_RULES.browser.icon,
    iconUrl: isPopupWindow ? null : (tab?.favicon ?? null),
    ariaLabel: ariaParts.filter((part) => part !== null).join(", "),
    tooltip: isPopupWindow ? [POPUP_WINDOW_TEXT, url].filter(Boolean).join("\n") : url,
    badge,
    isAgentActive,
    hasPrompts: (tab?.prompts.length ?? 0) > 0,
  };
};
