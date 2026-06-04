import { describe, expect, test } from "bun:test";
import type { BeadsCheck, RuntimeCheck } from "@openducktor/contracts";
import { buildDiagnosticsPanelModel } from "./diagnostics-panel-model";
import {
  makeBeadsCheck,
  makeRepoHealth,
  makeWorkspace,
  runtimeDefinitions,
  runtimeSummary,
} from "./diagnostics-panel-model-test-fixtures";

const readyRuntimeCheck: RuntimeCheck = {
  gitOk: true,
  gitVersion: "git version 2.50.1",
  ghOk: true,
  ghVersion: "gh version 2.73.0",
  ghAuthOk: true,
  ghAuthLogin: "octocat",
  ghAuthError: null,
  runtimes: [{ kind: "opencode", ok: true, version: "1.2.9" }],
  errors: [],
};

const buildBeadsDiagnosticsModel = (beadsCheck: BeadsCheck) =>
  buildDiagnosticsPanelModel({
    workspaceRepoPath: "/repo",
    activeWorkspace: makeWorkspace("/repo"),
    runtimeDefinitions,
    isLoadingRuntimeDefinitions: false,
    runtimeDefinitionsError: null,
    runtimeCheck: readyRuntimeCheck,
    beadsCheck,
    runtimeCheckFailureKind: null,
    beadsCheckFailureKind: null,
    runtimeHealthByRuntime: {
      opencode: makeRepoHealth({
        runtime: { instance: runtimeSummary },
        mcp: { toolIds: [] },
      }),
    },
    isLoadingChecks: false,
  });

describe("buildDiagnosticsPanelModel Beads executable provenance", () => {
  test("renders bundled and override executable provenance for Beads diagnostics", () => {
    const model = buildBeadsDiagnosticsModel(
      makeBeadsCheck({
        beadsExecutable: {
          displayLabel: "Bundled with OpenDucktor",
          error: null,
          path: "/Applications/OpenDucktor.app/Contents/Resources/bin/bd",
          sourceCategory: "bundled_electron_resource",
        },
        doltExecutable: {
          displayLabel: "Environment override",
          error: null,
          path: "/opt/dolt/bin/dolt",
          sourceCategory: "environment_override",
        },
      }),
    );

    const beadsSection = model.sections.find((section) => section.key === "beads-store");

    expect(beadsSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Beads executable source",
          value: "Bundled with OpenDucktor",
        }),
        expect.objectContaining({
          label: "Beads executable path",
          value: "/Applications/OpenDucktor.app/Contents/Resources/bin/bd",
        }),
        expect.objectContaining({ label: "Dolt executable source", value: "Environment override" }),
        expect.objectContaining({ label: "Dolt executable path", value: "/opt/dolt/bin/dolt" }),
      ]),
    );
  });

  test("renders unavailable executable provenance without duplicating primary errors", () => {
    const missingBeads =
      "Packaged Electron Beads sidecar is missing or invalid: expected bd in /Applications/OpenDucktor.app/Contents/Resources/bin. This is an OpenDucktor packaging defect.";
    const missingDolt =
      "Packaged Electron Dolt sidecar is missing or invalid: expected dolt in /Applications/OpenDucktor.app/Contents/Resources/bin. This is an OpenDucktor packaging defect.";
    const model = buildBeadsDiagnosticsModel(
      makeBeadsCheck({
        beadsOk: false,
        beadsPath: null,
        beadsError: missingBeads,
        beadsExecutable: {
          displayLabel: "Unavailable",
          error: missingBeads,
          path: null,
          sourceCategory: "unavailable",
        },
        doltExecutable: {
          displayLabel: "Unavailable",
          error: missingDolt,
          path: null,
          sourceCategory: "unavailable",
        },
        repoStoreHealth: {
          category: "attachment_verification_failed",
          status: "blocking",
          isReady: false,
          detail: missingBeads,
          attachment: {
            path: null,
            databaseName: null,
          },
          sharedServer: {
            host: null,
            port: null,
            ownershipState: "unavailable",
          },
        },
      }),
    );

    const beadsSection = model.sections.find((section) => section.key === "beads-store");

    expect(beadsSection?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Beads executable path", value: "Unavailable" }),
        expect.objectContaining({ label: "Dolt executable path", value: "Unavailable" }),
      ]),
    );
    expect(beadsSection?.errors).toEqual([missingBeads, missingDolt]);
  });
});
