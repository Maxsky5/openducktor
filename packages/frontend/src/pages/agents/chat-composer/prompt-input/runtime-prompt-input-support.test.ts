import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR, type RuntimeKind } from "@openducktor/contracts";
import { resolveRuntimePromptInputSupport } from "./runtime-prompt-input-support";

describe("runtime-prompt-input-support", () => {
  test("derives runtime prompt input capabilities", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        readyActiveSessionRuntimeKind: null,
        selectedRuntimeKind: "opencode",
      }),
    ).toEqual({ runtimeSupportsSlashCommands: true, supportsFileSearch: true });
  });

  test("returns false when no runtime kind is available", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        readyActiveSessionRuntimeKind: null,
        selectedRuntimeKind: null,
      }),
    ).toEqual({ runtimeSupportsSlashCommands: false, supportsFileSearch: false });
  });

  test("prefers the ready active-session runtime kind over the selected runtime kind", () => {
    expect(
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        readyActiveSessionRuntimeKind: "opencode",
        selectedRuntimeKind: "unregistered-runtime" as RuntimeKind,
      }),
    ).toEqual({ runtimeSupportsSlashCommands: true, supportsFileSearch: true });
  });
});
