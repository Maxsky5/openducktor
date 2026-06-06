import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeKind,
} from "@openducktor/contracts";
import { resolveRuntimePromptInputSupport } from "./runtime-prompt-input-support";

describe("runtime-prompt-input-support", () => {
  test("derives runtime prompt input capabilities", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        hasActiveSession: false,
        activeSessionRuntimeKind: null,
        selectedRuntimeKind: "opencode",
      }),
    ).toEqual({
      runtimeSupportsSlashCommands: true,
      supportsFileSearch: true,
      supportsSkillReferences: false,
    });
  });

  test("derives Codex file search and skill reference capabilities", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
        hasActiveSession: false,
        activeSessionRuntimeKind: null,
        selectedRuntimeKind: "codex",
      }),
    ).toEqual({
      runtimeSupportsSlashCommands: false,
      supportsFileSearch: true,
      supportsSkillReferences: true,
    });
  });

  test("returns false when no runtime kind is available", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        hasActiveSession: false,
        activeSessionRuntimeKind: null,
        selectedRuntimeKind: null,
      }),
    ).toEqual({
      runtimeSupportsSlashCommands: false,
      supportsFileSearch: false,
      supportsSkillReferences: false,
    });
  });

  test("prefers the active-session runtime kind over the selected runtime kind", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        hasActiveSession: true,
        activeSessionRuntimeKind: "opencode",
        selectedRuntimeKind: "unregistered-runtime" as RuntimeKind,
      }),
    ).toEqual({
      runtimeSupportsSlashCommands: true,
      supportsFileSearch: true,
      supportsSkillReferences: false,
    });
  });

  test("does not fall back to the selected runtime while active session context is unresolved", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        hasActiveSession: true,
        activeSessionRuntimeKind: null,
        selectedRuntimeKind: "opencode",
      }),
    ).toEqual({
      runtimeSupportsSlashCommands: false,
      supportsFileSearch: false,
      supportsSkillReferences: false,
    });
  });
});
