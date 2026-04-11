import { describe, expect, test } from "bun:test";
import { buildDiagnosticsSummary } from "./diagnostics-model";

describe("buildDiagnosticsSummary", () => {
  test("returns checking state while diagnostics are loading", () => {
    const summary = buildDiagnosticsSummary({
      hasActiveRepo: true,
      isChecking: true,
      hasCriticalIssues: false,
      hasSetupIssues: false,
    });

    expect(summary.label).toBe("Checking...");
    expect(summary.toneClass).toBe("text-muted-foreground");
    expect(summary.iconClass).toBe("text-muted-foreground");
  });

  test("keeps no-repository label as highest priority", () => {
    const summary = buildDiagnosticsSummary({
      hasActiveRepo: false,
      isChecking: true,
      hasCriticalIssues: true,
      hasSetupIssues: true,
    });

    expect(summary.label).toBe("No repository selected");
  });

  test("returns healthy only when not checking and no issues", () => {
    const summary = buildDiagnosticsSummary({
      hasActiveRepo: true,
      isChecking: false,
      hasCriticalIssues: false,
      hasSetupIssues: false,
    });

    expect(summary.label).toBe("Healthy");
  });

  test("keeps critical issues ahead of retrying state", () => {
    const summary = buildDiagnosticsSummary({
      hasActiveRepo: true,
      isChecking: true,
      hasCriticalIssues: true,
      hasSetupIssues: false,
    });

    expect(summary.label).toBe("Critical issue");
    expect(summary.toneClass).toBe("text-destructive-muted");
  });
});
