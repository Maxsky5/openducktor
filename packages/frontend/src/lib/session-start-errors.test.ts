import { describe, expect, test } from "bun:test";
import {
  missingSessionDefaultModelError,
  unavailableSessionDefaultCatalogError,
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

  test("names the role, runtime, cause, and settings location for an unloadable catalog", () => {
    expect(
      unavailableSessionDefaultCatalogError({
        role: "build",
        runtimeKind: "codex",
        causeDetail: "Cannot resolve the selected runtime. Start it from the runtime controls.",
      }),
    ).toBe(
      "The saved Builder default or repository Default Model for runtime codex could not load. Cannot resolve the selected runtime. Start it from the runtime controls. Update the default in Settings > Repositories > Agents.",
    );
  });

  test("omits the cause detail when the cause has no message", () => {
    expect(
      unavailableSessionDefaultCatalogError({
        role: "qa",
        runtimeKind: "opencode",
        causeDetail: "   ",
      }),
    ).toBe(
      "The saved QA default or repository Default Model for runtime opencode could not load. Update the default in Settings > Repositories > Agents.",
    );
  });
});
