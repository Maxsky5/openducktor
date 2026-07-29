import { describe, expect, test } from "bun:test";
import { createEmptyComposerDraft } from "./agent-chat-composer-draft";
import type { AgentChatDraftScope } from "./agent-chat-draft-scope";

describe("agent chat draft scope", () => {
  test("accepts an opaque non-task identity without persistence", () => {
    const scope = {
      key: "repository-chat:conversation/42",
      persistence: null,
    } satisfies AgentChatDraftScope;

    expect(scope.key).toBe("repository-chat:conversation/42");
    expect(scope.persistence).toBeNull();
  });

  test("accepts caller-owned persistence behavior", () => {
    const draft = createEmptyComposerDraft();
    const scope = {
      key: "caller-owned",
      persistence: {
        hydrate: () => draft,
        set: () => 1,
        readVersion: () => 1,
        clear: () => true,
        flush: async () => {},
      },
    } satisfies AgentChatDraftScope;

    expect(scope.persistence.hydrate()).toBe(draft);
  });
});
