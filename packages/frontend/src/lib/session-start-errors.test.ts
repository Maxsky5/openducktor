import { describe, expect, test } from "bun:test";
import {
  missingSessionDefaultModelError,
  unavailableSessionDefaultModelError,
} from "./session-start-errors";

describe("session start errors", () => {
  test("names the role and the settings location for a missing default model", () => {
    expect(missingSessionDefaultModelError("build")).toBe(
      "No model is configured for the Builder session. Set a Builder default or the repository Default Model in Settings > Repositories > Agents.",
    );
  });

  test("names the role and runtime for an unavailable default model", () => {
    expect(unavailableSessionDefaultModelError({ role: "qa", runtimeKind: "codex" })).toBe(
      "The saved QA default or repository Default Model is not available for runtime codex. Update it in Settings > Repositories > Agents.",
    );
  });
});
