import type { BrowserPrompt } from "@openducktor/contracts";
/** One prompt kind of `BrowserPrompt`. */
export type BrowserPromptOf<Kind extends BrowserPrompt["kind"]> = Extract<
  BrowserPrompt,
  { kind: Kind }
>;
