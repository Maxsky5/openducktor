export const isTerminalToggleShortcut = (event: Pick<KeyboardEvent, "ctrlKey" | "key">): boolean =>
  event.ctrlKey && event.key === "`";
