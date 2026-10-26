import { describe, expect, test } from "bun:test";
import {
  DIAGNOSTICS_ISSUE_SCOPE_LABELS,
  diagnosticsCheckErrorTone,
  diagnosticsOverviewPresentation,
  diagnosticsStatusAccessibilityLabel,
  diagnosticsStatusPresentation,
  diagnosticsSummaryPresentation,
  runtimeExecutableText,
} from "./diagnostics-presentation";

describe("diagnostics presentation", () => {
  test("each check health maps to the desktop badge variant", () => {
    expect(diagnosticsStatusPresentation("ok")).toEqual({ variant: "success", inProgress: false });
    expect(diagnosticsStatusPresentation("warning").variant).toBe("warning");
    expect(diagnosticsStatusPresentation("failed")).toEqual({
      variant: "danger",
      inProgress: false,
    });
    expect(diagnosticsStatusPresentation("neutral")).toEqual({
      variant: "secondary",
      inProgress: false,
    });
  });

  test("loading and busy checks show progress", () => {
    for (const health of ["loading", "busy"] as const) {
      expect(diagnosticsStatusPresentation(health)).toEqual({
        variant: "secondary",
        inProgress: true,
      });
    }
  });

  test("the overview tone maps to a desktop status family and a glyph", () => {
    expect(diagnosticsOverviewPresentation("healthy")).toEqual({
      family: "success",
      glyph: "ok",
      inProgress: false,
    });
    expect(diagnosticsOverviewPresentation("checking")).toMatchObject({
      family: "neutral",
      glyph: "progress",
      inProgress: true,
    });
    expect(diagnosticsOverviewPresentation("warning").family).toBe("warning");
    expect(diagnosticsOverviewPresentation("critical")).toMatchObject({
      family: "destructive",
      glyph: "failed",
    });
  });

  test("the summary uses the colors of the desktop diagnostics trigger", () => {
    expect(diagnosticsSummaryPresentation("healthy").variant).toBe("success");
    expect(diagnosticsSummaryPresentation("setup").variant).toBe("warning");
    expect(diagnosticsSummaryPresentation("critical").variant).toBe("danger");
    expect(diagnosticsSummaryPresentation("checking")).toEqual({
      variant: "secondary",
      inProgress: true,
    });
  });

  test("only a setup warning keeps its errors as warnings", () => {
    expect(diagnosticsCheckErrorTone({ status: { health: "warning", label: "Needs setup" } })).toBe(
      "warning",
    );
    expect(diagnosticsCheckErrorTone({ status: { health: "failed", label: "Issue" } })).toBe(
      "destructive",
    );
  });

  test("issue scopes use the desktop labels", () => {
    expect(DIAGNOSTICS_ISSUE_SCOPE_LABELS).toEqual({ host: "Host", workspace: "Workspace" });
  });

  test("a runtime without a configured executable says so in plain text", () => {
    expect(runtimeExecutableText({ executablePath: null })).toEqual({
      text: "Default executable",
      isPath: false,
    });
    expect(runtimeExecutableText({ executablePath: "/usr/local/bin/codex" })).toEqual({
      text: "/usr/local/bin/codex",
      isPath: true,
    });
  });

  test("a status name includes its subject", () => {
    expect(diagnosticsStatusAccessibilityLabel("Git", { health: "ok", label: "Available" })).toBe(
      "Git: Available",
    );
  });
});
