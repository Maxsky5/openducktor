// The composer of agent-chat-composer.tsx. The task sessions and the chats share it.
import { must } from "../../motion/dom";
import { compactTokens, type ContextUse } from "../format";
import type { Activity } from "../vocabulary";

/** The activity of the composer in `root`: the running ray, or the waiting ring. */
export function composerActivity(root: HTMLElement) {
  const composer = must(root, "[data-composer]");
  return (activity: Activity): void => {
    composer.dataset.activity = activity;
  };
}

/** The context ring of the composer, in the format of agent-context-usage-indicator.tsx. */
export function contextMeter(meter: HTMLElement) {
  const tokens = must(meter, "[data-tokens]");
  return (use: ContextUse): void => {
    meter.style.setProperty("--used", `${Math.min(use.percent, 100)}`);
    tokens.textContent = compactTokens(use.tokens);
  };
}
