import { describe, expect, test } from "bun:test";
import {
  isSessionStartModeUnavailable,
  orderStartModesForDisplay,
  sessionStartModeButtonLabel,
  sessionStartModelPlaceholder,
  sessionStartModelReadOnlyReason,
  sessionStartRuntimeProfileHelperText,
  sessionStartTargetBranchPlaceholder,
  sessionStartVariantPlaceholder,
} from "./session-start-display";

describe("session start display", () => {
  test("orders and names the start modes", () => {
    expect(orderStartModesForDisplay(["fork", "fresh", "reuse"])).toEqual([
      "fresh",
      "reuse",
      "fork",
    ]);
    const modes = ["fresh", "reuse", "fork"] as const;
    expect(modes.map(sessionStartModeButtonLabel)).toEqual([
      "Start fresh",
      "Reuse existing",
      "Fork existing",
    ]);
  });

  test("makes a source-based mode unavailable when the task has no session", () => {
    expect(isSessionStartModeUnavailable("reuse", false)).toBe(true);
    expect(isSessionStartModeUnavailable("fork", false)).toBe(true);
    expect(isSessionStartModeUnavailable("fresh", false)).toBe(false);
    expect(isSessionStartModeUnavailable("fork", true)).toBe(false);
  });

  test("explains the effort choice", () => {
    const base = {
      isSelectionCatalogLoading: false,
      hasSelectedModel: true,
      supportsVariants: true,
      variantCount: 2,
    };
    expect(sessionStartVariantPlaceholder({ ...base, isSelectionCatalogLoading: true })).toBe(
      "Checking compatibility...",
    );
    expect(sessionStartVariantPlaceholder({ ...base, hasSelectedModel: false })).toBe(
      "Select model first",
    );
    expect(sessionStartVariantPlaceholder({ ...base, supportsVariants: false })).toBe(
      "Effort handled by runtime",
    );
    expect(sessionStartVariantPlaceholder({ ...base, variantCount: 0 })).toBe(
      "This model has no effort options",
    );
    expect(sessionStartVariantPlaceholder(base)).toBe("Select effort");
  });

  test("explains the runtime profile and model choices", () => {
    expect(
      sessionStartRuntimeProfileHelperText({
        runtimeProfileCount: 2,
        isReuseMode: true,
        isSelectionCatalogLoading: true,
      }),
    ).toBe("Reuse mode keeps the previous session runtime profile, model, and effort.");
    expect(
      sessionStartRuntimeProfileHelperText({
        runtimeProfileCount: 0,
        isReuseMode: false,
        isSelectionCatalogLoading: false,
      }),
    ).toBe("No profiles are available for this runtime.");
    expect(
      sessionStartRuntimeProfileHelperText({
        runtimeProfileCount: 1,
        isReuseMode: false,
        isSelectionCatalogLoading: false,
      }),
    ).toBeNull();
    expect(sessionStartModelReadOnlyReason(true)).toBe("Session start is in progress.");
    expect(sessionStartModelPlaceholder(true)).toBe("Loading models...");
    expect(sessionStartTargetBranchPlaceholder(0)).toBe("Branches unavailable");
  });
});
