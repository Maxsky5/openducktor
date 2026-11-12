// The sample data of the browser scene: the tooltips that the visitor sees on the way.

/** The tooltip of the New tab button of a panel strip: session-panel.tsx. */
export const NEW_TAB_TIP = "New tab";

/** The tooltips of Share with agents, off and on: browser-toolbar.tsx. */
export const SHARE_TIPS = {
  off: "Let agents use this tab.",
  on: "Agents can use this tab. Click to stop sharing.",
} as const;
