import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
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
});
