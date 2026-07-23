import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import { resolveRuntimePromptInputSupport } from "./runtime-prompt-input-support";

describe("runtime-prompt-input-support", () => {
  test("derives runtime prompt input capabilities", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: "opencode",
      }),
    ).toEqual({
      supportsAttachments: true,
      runtimeSupportsSlashCommands: true,
      supportsFileSearch: true,
      supportsSkillReferences: false,
      supportsSubagentReferences: true,
    });
  });

  test("derives Codex file search and skill reference capabilities", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
        runtimeKind: "codex",
      }),
    ).toEqual({
      supportsAttachments: true,
      runtimeSupportsSlashCommands: true,
      supportsFileSearch: true,
      supportsSkillReferences: true,
      supportsSubagentReferences: false,
    });
  });

  test("derives Claude slash command, file search, and skill reference capabilities", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [CLAUDE_RUNTIME_DESCRIPTOR],
        runtimeKind: "claude",
      }),
    ).toEqual({
      supportsAttachments: true,
      runtimeSupportsSlashCommands: true,
      supportsFileSearch: true,
      supportsSkillReferences: true,
      supportsSubagentReferences: false,
    });
  });

  test("returns false when no runtime kind is available", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: null,
      }),
    ).toEqual({
      supportsAttachments: false,
      runtimeSupportsSlashCommands: false,
      supportsFileSearch: false,
      supportsSkillReferences: false,
      supportsSubagentReferences: false,
    });
  });

  test("returns false when the selected runtime kind is not in the supplied definitions", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        runtimeKind: "codex",
      }),
    ).toEqual({
      supportsAttachments: false,
      runtimeSupportsSlashCommands: false,
      supportsFileSearch: false,
      supportsSkillReferences: false,
      supportsSubagentReferences: false,
    });
  });
});
