import { describe, expect, test } from "bun:test";
import { buildDiagnosticsSummary } from "./diagnostics-summary";

describe("buildDiagnosticsSummary", () => {
  test("a blocking failure wins over loading and setup", () => {
    expect(
      buildDiagnosticsSummary({ isChecking: true, hasCriticalIssues: true, hasSetupIssues: true }),
    ).toEqual({ label: "Critical issue", tone: "critical" });
  });

  test("loading wins over a setup warning", () => {
    expect(
      buildDiagnosticsSummary({ isChecking: true, hasCriticalIssues: false, hasSetupIssues: true }),
    ).toEqual({ label: "Checking...", tone: "checking" });
  });

  test("a setup warning shows when nothing blocks or loads", () => {
    expect(
      buildDiagnosticsSummary({
        isChecking: false,
        hasCriticalIssues: false,
        hasSetupIssues: true,
      }),
    ).toEqual({ label: "Setup needed", tone: "setup" });
  });

  test("no issue is healthy", () => {
    expect(
      buildDiagnosticsSummary({
        isChecking: false,
        hasCriticalIssues: false,
        hasSetupIssues: false,
      }),
    ).toEqual({ label: "Healthy", tone: "healthy" });
  });
});
