import type { BrowserPrompt, BrowserPromptAnswer, BrowserPromptKind } from "@openducktor/contracts";
import { Effect } from "effect";
import { BrowserServiceError } from "./browser-service-error";
import type { BrowserTabRegistry } from "./browser-tab-registry";

type DistributiveOmit<Value, Key extends PropertyKey> = Value extends unknown
  ? Omit<Value, Key>
  : never;

export type BrowserPromptInput = DistributiveOmit<BrowserPrompt, "promptId">;

type AnswerHandler = (answer: BrowserPromptAnswer) => Effect.Effect<void, BrowserServiceError>;

type PromptEntry = {
  prompt: BrowserPrompt;
  onAnswer: AnswerHandler;
  /** Runs when the prompt goes away without an answer, for example after a navigation. */
  dismiss: (() => void) | null;
};

export type BrowserPromptBook = ReturnType<typeof createBrowserPromptBook>;

/** Open prompts of each tab. The tab summary lists them in the order that they opened. */
export const createBrowserPromptBook = (
  registry: Pick<BrowserTabRegistry, "update">,
  newPromptId: () => string,
) => {
  const byTab = new Map<string, Map<string, PromptEntry>>();

  const publish = (tabId: string): void => {
    const entries = byTab.get(tabId);
    const prompts = entries ? Array.from(entries.values(), (entry) => entry.prompt) : [];
    registry.update(tabId, (summary) => ({ ...summary, prompts }));
  };

  const add = (
    tabId: string,
    input: BrowserPromptInput,
    onAnswer: AnswerHandler,
    dismiss: (() => void) | null = null,
  ): BrowserPrompt => {
    // SAFETY: the input is one prompt variant without its ID; adding the ID gives the same variant.
    const prompt = { ...input, promptId: newPromptId() } as BrowserPrompt;
    let entries = byTab.get(tabId);
    if (!entries) {
      entries = new Map();
      byTab.set(tabId, entries);
    }
    entries.set(prompt.promptId, { prompt, onAnswer, dismiss });
    publish(tabId);
    return prompt;
  };

  /** Changes an open prompt. Its ID stays, so an answer to it still reaches it. */
  const update = (
    tabId: string,
    promptId: string,
    change: (prompt: BrowserPrompt) => BrowserPrompt,
  ): void => {
    const entry = byTab.get(tabId)?.get(promptId);
    if (!entry) {
      return;
    }
    entry.prompt = { ...change(entry.prompt), promptId };
    publish(tabId);
  };

  const take = (tabId: string, promptId: string): PromptEntry | null => {
    const entries = byTab.get(tabId);
    const entry = entries?.get(promptId);
    if (!entries || !entry) {
      return null;
    }
    entries.delete(promptId);
    publish(tabId);
    return entry;
  };

  const remove = (tabId: string, promptId: string): void => {
    take(tabId, promptId)?.dismiss?.();
  };

  const removeKind = (tabId: string, kind: BrowserPromptKind): void => {
    const entries = byTab.get(tabId);
    if (!entries) {
      return;
    }
    const removed: PromptEntry[] = [];
    for (const [promptId, entry] of entries) {
      if (entry.prompt.kind === kind) {
        entries.delete(promptId);
        removed.push(entry);
      }
    }
    if (removed.length > 0) {
      publish(tabId);
    }
    for (const entry of removed) entry.dismiss?.();
  };

  const find = <Kind extends BrowserPromptKind>(
    tabId: string,
    kind: Kind,
  ): Extract<BrowserPrompt, { kind: Kind }> | null => {
    for (const entry of byTab.get(tabId)?.values() ?? []) {
      if (entry.prompt.kind === kind) {
        // SAFETY: the loop checked that this prompt has the requested kind.
        return entry.prompt as Extract<BrowserPrompt, { kind: Kind }>;
      }
    }
    return null;
  };

  const answer = (
    tabId: string,
    promptId: string,
    value: BrowserPromptAnswer,
  ): Effect.Effect<void, BrowserServiceError> =>
    Effect.gen(function* () {
      const entry = byTab.get(tabId)?.get(promptId);
      if (!entry) {
        return yield* new BrowserServiceError({
          code: "browser_prompt_not_found",
          operation: "browser.prompt.answer",
          message: "This prompt is no longer open.",
          tabId,
        });
      }
      if (entry.prompt.kind !== value.kind) {
        return yield* new BrowserServiceError({
          code: "browser_invalid_input",
          operation: "browser.prompt.answer",
          message: `A ${entry.prompt.kind} prompt cannot take a ${value.kind} answer.`,
          tabId,
        });
      }
      take(tabId, promptId);
      yield* entry.onAnswer(value);
    });

  const clearTab = (tabId: string): void => {
    const entries = byTab.get(tabId);
    if (!entries) {
      return;
    }
    byTab.delete(tabId);
    publish(tabId);
    for (const entry of entries.values()) entry.dismiss?.();
  };

  return { add, update, remove, removeKind, find, answer, clearTab };
};
