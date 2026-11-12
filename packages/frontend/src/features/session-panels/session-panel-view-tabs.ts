import { createContext } from "react";
import type { ViewTabKind } from "./panel-tab-kinds";
import type { ToolTabView } from "./session-panel";

/**
 * The views of the view-kind tabs of the page, such as the tool call that the transcript shows.
 * The page gives them once at its root, so both of its panels show them.
 */
export const SessionPanelViewTabsContext = createContext<Partial<
  Record<ViewTabKind, ToolTabView>
> | null>(null);
