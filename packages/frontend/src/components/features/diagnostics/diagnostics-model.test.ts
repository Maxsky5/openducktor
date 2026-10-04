import { describe, expect, test } from "bun:test";
import { buildDiagnosticsSummary } from "./diagnostics-model";

describe("buildDiagnosticsSummary", () => {
  test("returns checking state while diagnostics are loading", () => {
    const summary = buildDiagnosticsSummary({
      isChecking: true,
      hasCriticalIssues: false,
      hasSetupIssues: false,
    });

    expect(summary.label).toBe("Checking...");
    expect(summary.toneClass).toBe("text-muted-foreground");
    expect(summary.iconClass).toBe("text-muted-foreground");
  });

  test("returns healthy only when not checking and no issues", () => {
    const summary = buildDiagnosticsSummary({
      isChecking: false,
      hasCriticalIssues: false,
      hasSetupIssues: false,
    });

    expect(summary.label).toBe("Healthy");
  });

  test("keeps critical issues ahead of checking state", () => {
    const summary = buildDiagnosticsSummary({
      isChecking: true,
      hasCriticalIssues: true,
      hasSetupIssues: false,
    });

    expect(summary.label).toBe("Critical issue");
    expect(summary.toneClass).toBe("text-destructive-muted");
  });

  test("keeps checking state ahead of setup warnings", () => {
    const summary = buildDiagnosticsSummary({
      isChecking: true,
      hasCriticalIssues: false,
      hasSetupIssues: true,
    });

    expect(summary.label).toBe("Checking...");
  });

  test("reports a setup warning when nothing else applies", () => {
    const summary = buildDiagnosticsSummary({
      isChecking: false,
      hasCriticalIssues: false,
      hasSetupIssues: true,
    });

    expect(summary.label).toBe("Setup needed");
  });
});
