import type { EffectNodeHostCommandRouter } from "@openducktor/host";
import { Effect } from "effect";

type BrowserService = EffectNodeHostCommandRouter["browserService"];

const unexpected = (operation: string) => () =>
  Effect.die(new Error(`Unexpected browser service operation: ${operation}`));

/** A browser service for web tests. Each operation that a test does not give fails the test. */
export const createBrowserServiceFake = (
  overrides: Partial<BrowserService> = {},
): BrowserService => ({
  engineKind: "chrome_for_testing",
  state: () => ({ kind: "ready", engine: "chrome_for_testing" }),
  listTabs: unexpected("listTabs"),
  openTab: unexpected("openTab"),
  startTab: unexpected("startTab"),
  reportFrameState: unexpected("reportFrameState"),
  closeTab: unexpected("closeTab"),
  navigate: unexpected("navigate"),
  setShared: unexpected("setShared"),
  answerPrompt: unexpected("answerPrompt"),
  readSitePermissions: unexpected("readSitePermissions"),
  resetSitePermissions: unexpected("resetSitePermissions"),
  setPicker: unexpected("setPicker"),
  captureAnnotation: unexpected("captureAnnotation"),
  revealDownload: unexpected("revealDownload"),
  showPopupWindow: unexpected("showPopupWindow"),
  openDevTools: unexpected("openDevTools"),
  connectClient: () => {
    throw new Error("Unexpected browser service operation: connectClient");
  },
  connectDevTools: unexpected("connectDevTools"),
  runAgentTool: unexpected("runAgentTool"),
  closeOwnerTabs: unexpected("closeOwnerTabs"),
  removeWorkspace: unexpected("removeWorkspace"),
  dispose: () => Effect.void,
  ...overrides,
});
