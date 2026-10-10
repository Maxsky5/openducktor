import { type TerminalTab, terminalTabLifecycle } from "./terminal-presentation-state";

export { terminalTabLabel, terminalTabLifecycle } from "./terminal-presentation-state";

export const terminalTabLifecycleText = (tab: TerminalTab): string => {
  if (tab.requestState === "creating") return "Creating";
  if (tab.requestState === "unsupported_runtime") return "Unsupported runtime";
  if (tab.requestState === "creation_failed") return "Creation failed";
  if (tab.requestState === "lost") return "Lost after host restart";
  const lifecycle = terminalTabLifecycle(tab);
  if (lifecycle === "starting") return "Starting";
  if (lifecycle === "closing") return "Closing";
  if (lifecycle === "close_failed") return "Close failed";
  if (lifecycle === "exited") return "Exited";
  return "Running";
};
