import { describe, expect, test } from "bun:test";
import { AGENT_BADGE } from "./sample/browser";
import { type BrowserCall, CALL_ORDER, CALLS } from "./scenes/agent-browser/sample";
import { importProduct } from "./test-support/product-source";

const CHAT = "packages/frontend/src/components/features/agents/agent-chat";

// SAFETY: browser-tool-summary.ts exports this function. It reads only the action and the input.
const { browserToolTitle } = await importProduct<{
  browserToolTitle: (action: string, input: BrowserCall["input"]) => string;
}>(`${CHAT}/browser-tool-summary.ts`);
// SAFETY: session-panel-tab-presentation.ts exports these labels.
const { PANEL_TAB_BADGE_LABELS } = await importProduct<{
  PANEL_TAB_BADGE_LABELS: Record<string, string>;
}>("packages/frontend/src/features/session-panels/session-panel-tab-presentation.ts");

describe("the agent browser copied from the app", () => {
  test("each Browser card shows the title that the app gives to its call", () => {
    for (const name of CALL_ORDER) {
      const call: BrowserCall = CALLS[name];
      expect(call.title).toBe(browserToolTitle(call.action, call.input));
    }
  });

  test("an agent tab shows the Agent badge of the app", () => {
    expect(AGENT_BADGE).toBe(PANEL_TAB_BADGE_LABELS.agent ?? "");
  });
});
