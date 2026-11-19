import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type KeyLabels, MAC_KEYS, PC_KEYS, steerKey } from "./replicas/keys";
import { composerHints, queueHints } from "./replicas/studio/Composer";
import { RUNTIMES, type RuntimeKind } from "./sample/models";
import {
  COMMAND,
  COMPACT_COMMAND,
  SKILLS,
  SLASH_COMMANDS,
  SLASH_QUERY,
} from "./scenes/composer/sample";
import { importProduct } from "./test-support/product-source";

type Named = { trigger: string } | { name: string };
type PromptInput = {
  supportsFileSearch: boolean;
  supportsSubagentReferences: boolean;
  supportsSlashCommands: boolean;
  supportsSkillReferences: boolean;
};
/** The chat state of an empty session that the composer policy reads. */
type PolicyModel = PromptInput & {
  selectedModelDescriptor: null;
  runningTurnModel: null;
  isSessionWorking: boolean;
  isSending: boolean;
  isStarting: boolean;
  isModelSelectionPending: boolean;
  isInteractionEnabled: boolean;
  isReadOnly: boolean;
  isWaitingInput: boolean;
  isResumingSession: boolean;
  speed: null;
  supportsAttachments: boolean;
  steerBlockedReason: null;
  readOnlyReason: null;
  messageQueue: null;
};
/** The draft of the composer: its segments, such as text. */
type Draft = { segments: readonly { kind: string }[] };
type PolicyInput = {
  model: PolicyModel;
  draft: Draft;
  primaryMode: "default";
  settingsReady: boolean;
  steerShortcutLabel: string;
};

// SAFETY: slash-command-schemas.ts exports this command, and a missing export fails the test.
const { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } = await importProduct<{
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND: {
    trigger: string;
    source: string;
    description: string;
  };
}>("packages/contracts/src/slash-command-schemas.ts");
// SAFETY: composer-autocomplete-filters.ts exports these functions, and a missing export fails the
// test.
const filters = await importProduct<{
  filterSlashCommands: <Item extends { trigger: string }>(items: Item[], query: string) => Item[];
  filterSkills: <Item extends { name: string }>(items: Item[], query: string) => Item[];
}>("packages/frontend-core/src/sessions/composer/composer-autocomplete-filters.ts");
// SAFETY: steer-shortcut.ts exports this function, and a missing export fails the test.
const { steerShortcutLabel } = await importProduct<{
  steerShortcutLabel: (applePlatform: boolean) => string;
}>("packages/frontend/src/lib/steer-shortcut.ts");
// SAFETY: runtime-descriptors.ts exports the descriptor of each runtime, and a missing export
// fails the test.
const { RUNTIME_DESCRIPTORS_BY_KIND } = await importProduct<{
  RUNTIME_DESCRIPTORS_BY_KIND: Record<RuntimeKind, { capabilities: { promptInput: PromptInput } }>;
}>("packages/contracts/src/runtime-descriptors.ts");
// SAFETY: agent-chat-composer-policy.ts exports this hook, and a missing export fails the test.
const { useComposerPolicy } = await importProduct<{
  useComposerPolicy: (input: PolicyInput) => { placeholder: string };
}>("packages/frontend-core/src/sessions/composer/agent-chat-composer-policy.ts");
// SAFETY: agent-chat-composer-draft.ts exports this function, and a missing export fails the test.
const { createEmptyComposerDraft } = await importProduct<{
  createEmptyComposerDraft: () => Draft;
}>("packages/frontend-core/src/drafts/agent-chat-composer-draft.ts");

const names = (items: readonly Named[]): string[] =>
  items.map((item) => ("trigger" in item ? item.trigger : item.name));

/**
 * The placeholder that the desktop composer of the app shows for an empty draft on `runtime`, idle
 * or while a turn runs, with the steer shortcut of the platform.
 */
function appPlaceholder(runtime: RuntimeKind, working: boolean, applePlatform: boolean): string {
  let placeholder = "";
  function Probe(): null {
    placeholder = useComposerPolicy({
      model: {
        ...RUNTIME_DESCRIPTORS_BY_KIND[runtime].capabilities.promptInput,
        selectedModelDescriptor: null,
        runningTurnModel: null,
        isSessionWorking: working,
        isSending: false,
        isStarting: false,
        isModelSelectionPending: false,
        isInteractionEnabled: true,
        isReadOnly: false,
        isWaitingInput: false,
        isResumingSession: false,
        speed: null,
        supportsAttachments: true,
        steerBlockedReason: null,
        readOnlyReason: null,
        messageQueue: null,
      },
      draft: createEmptyComposerDraft(),
      primaryMode: "default",
      settingsReady: true,
      steerShortcutLabel: steerShortcutLabel(applePlatform),
    }).placeholder;
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return placeholder;
}

const PLATFORMS: readonly { keys: KeyLabels; applePlatform: boolean }[] = [
  { keys: MAC_KEYS, applePlatform: true },
  { keys: PC_KEYS, applePlatform: false },
];

describe("the composer copied from the app", () => {
  test("the slash menu starts with /compact of the app", () => {
    const { trigger, source: kind, description } = MANUAL_SESSION_COMPACTION_SLASH_COMMAND;
    expect({ trigger, source: kind, description }).toEqual(COMPACT_COMMAND);
  });

  test("the slash query makes the picked command the first row", () => {
    const shown = filters.filterSlashCommands([...SLASH_COMMANDS], SLASH_QUERY.slice(1));
    expect(names(shown)[0]).toBe(COMMAND);
  });

  test("the skill menu lists the skills in the order of the app", () => {
    expect(names(filters.filterSkills([...SKILLS], ""))).toEqual(names(SKILLS));
  });

  test("the queue hint shows the steer shortcut of each platform", () => {
    expect(steerKey(MAC_KEYS)).toBe(steerShortcutLabel(true));
    expect(steerKey(PC_KEYS)).toBe(steerShortcutLabel(false));
  });

  test("the placeholder follows the runtime, and adds the queue keys while the agent works", () => {
    for (const runtime of RUNTIMES) {
      for (const { keys, applePlatform } of PLATFORMS) {
        expect(composerHints(runtime)).toBe(appPlaceholder(runtime, false, applePlatform));
        expect(`${composerHints(runtime)}; ${queueHints(keys)}`).toBe(
          appPlaceholder(runtime, true, applePlatform),
        );
      }
    }
  });
});
