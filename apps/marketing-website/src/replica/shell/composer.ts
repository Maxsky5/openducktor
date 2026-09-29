// The composer of agent-chat-composer.tsx and the session status marks of its task tabs. The
// Agent Studio and the workspace chat share them.
import { must } from "../../motion/dom";
import { compactTokens, type ContextUse } from "../format";
import type { Activity } from "../vocabulary";

/** The activity marks of the task tab in `root`: a spinner, a waiting mark, or an idle mark. */
export function activityMarks(root: HTMLElement) {
  const status = must(root, "[data-tab-status]");
  const composer = must(root, "[data-composer]");
  /** Shows one activity in the tab and in the composer border. */
  return (activity: Activity): void => {
    status.dataset.activity = activity;
    composer.dataset.activity = activity;
  };
}

/** The context meter of the composer, in the format of agent-context-usage-indicator.tsx. */
export function contextMeter(meter: HTMLElement) {
  const text = must(meter, "[data-context]");
  const tokens = must(meter, "[data-tokens]");
  return (use: ContextUse): void => {
    meter.style.setProperty("--used", `${use.percent}%`);
    text.textContent = `${use.percent.toFixed(1)}%`;
    tokens.textContent = compactTokens(use.tokens);
  };
}
