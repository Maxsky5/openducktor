export const toggleTerminalPanel = (
  currentlyVisible: boolean,
): { visible: boolean; requestFocus: boolean } => ({
  visible: !currentlyVisible,
  requestFocus: !currentlyVisible,
});

export const isTerminalToggleShortcut = (event: Pick<KeyboardEvent, "ctrlKey" | "key">): boolean =>
  event.ctrlKey && event.key === "`";
