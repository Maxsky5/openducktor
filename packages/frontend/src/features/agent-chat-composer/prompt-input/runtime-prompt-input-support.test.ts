import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { resolveRuntimePromptInputSupport } from "./runtime-prompt-input-support";

describe("runtime-prompt-input-support", () => {
  test("derives runtime prompt input capabilities", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: "opencode",
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
        runtimeKind: "codex",
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
        runtimeKind: null,
      }),
    ).toEqual({
      runtimeSupportsSlashCommands: false,
      supportsFileSearch: false,
      supportsSkillReferences: false,
    });
  });

  test("returns false when the selected runtime kind is not in the supplied definitions", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: "codex",
      }),
    ).toEqual({
      runtimeSupportsSlashCommands: false,
      supportsFileSearch: false,
      supportsSkillReferences: false,
    });
  });
});
