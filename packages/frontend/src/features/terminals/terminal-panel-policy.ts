export const toggleTerminalPanel = (currentlyVisible: boolean) =>
  ({
    visible: !currentlyVisible,
    requestFocus: !currentlyVisible,
  }) satisfies { visible: boolean; requestFocus: boolean };

export const isTerminalToggleShortcut = (event: Pick<KeyboardEvent, "ctrlKey" | "key">): boolean =>
  event.ctrlKey && event.key === "`";
