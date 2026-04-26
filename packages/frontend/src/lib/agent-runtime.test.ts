import { describe, expect, test } from "bun:test";
import type { RuntimeDescriptor } from "@openducktor/contracts";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  requiredRuntimeSupportedScopes,
} from "@openducktor/contracts";
import {
  filterRuntimeDefinitionsForDefaultSelection,
  filterRuntimeDefinitionsForRole,
  getMissingMandatoryRuntimeCapabilities,
  getRuntimeDescriptorCapabilityConfigErrors,
  resolveRuntimeKindSelection,
  resolveRuntimeKindSelectionState,
  runtimeSupportsRole,
  validateRuntimeDefinitionForOpenDucktor,
  validateRuntimeDefinitionsForOpenDucktor,
} from "./agent-runtime";

const withCapabilities = (
  overrides: Partial<RuntimeDescriptor["capabilities"]>,
): RuntimeDescriptor => ({
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  capabilities: {
    ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
    ...overrides,
  },
});

describe("agent-runtime capability policies", () => {
  test("pins the required workflow scope set", () => {
    expect(requiredRuntimeSupportedScopes).toEqual(["workspace", "task", "build"]);
    expect(OPENCODE_RUNTIME_DESCRIPTOR.capabilities.supportedScopes).toEqual(
      requiredRuntimeSupportedScopes,
    );
  });

  test("reports missing mandatory capabilities", () => {
    const descriptor = withCapabilities({
      supportsOdtWorkflowTools: false,
    });

    expect(getMissingMandatoryRuntimeCapabilities(descriptor)).toEqual([
      "supportsOdtWorkflowTools",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([
      "missing mandatory capabilities: supportsOdtWorkflowTools",
    ]);
  });

  test("accepts optional capability combinations without extra invariants", () => {
    const descriptor = withCapabilities({
      supportsProfiles: true,
      supportsSlashCommands: true,
      supportsMcpStatus: false,
    });

    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([]);
  });

  test("reports runtimes that do not cover every workflow scope", () => {
    const workspaceOnly = withCapabilities({
      supportedScopes: ["workspace"],
    });

    expect(getRuntimeDescriptorCapabilityConfigErrors(workspaceOnly)).toEqual([
      "missing required workflow scopes: task, build",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(workspaceOnly)).toEqual([
      "missing required workflow scopes: task, build",
    ]);
  });

  test("reports incompatible runtime definitions with runtime-specific context", () => {
    const descriptor = withCapabilities({
      supportsOdtWorkflowTools: false,
      supportedScopes: ["workspace"],
    });

    expect(validateRuntimeDefinitionsForOpenDucktor([descriptor])).toEqual([
      "Runtime 'opencode' is incompatible with OpenDucktor: missing mandatory capabilities: supportsOdtWorkflowTools; missing required workflow scopes: task, build",
    ]);
  });

  test("runtime selection resolution never falls back to OpenCode implicitly", () => {
    const codex = {
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      kind: "codex",
      label: "Codex",
    } satisfies RuntimeDescriptor;

    expect(
      resolveRuntimeKindSelectionState({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, codex],
        requestedRuntimeKind: "codex",
      }),
    ).toEqual({
      status: "resolved",
      runtimeKind: "codex",
      requestedRuntimeKind: "codex",
    });
    expect(
      resolveRuntimeKindSelectionState({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        requestedRuntimeKind: null,
      }),
    ).toEqual({ status: "missing-request", runtimeKind: null });
    expect(
      resolveRuntimeKindSelectionState({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        requestedRuntimeKind: "codex",
      }),
    ).toEqual({ status: "unknown-request", runtimeKind: null, requestedRuntimeKind: "codex" });
    expect(
      resolveRuntimeKindSelectionState({
        runtimeDefinitions: [],
        requestedRuntimeKind: "codex",
      }),
    ).toEqual({ status: "no-definitions", runtimeKind: null, requestedRuntimeKind: "codex" });
    expect(
      resolveRuntimeKindSelection({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
        requestedRuntimeKind: null,
      }),
    ).toBeNull();
  });

  test("uses role-specific scopes for role selection while defaults require all scopes", () => {
    const workspaceOnly = withCapabilities({
      supportedScopes: ["workspace"],
    });
    const buildAndWorkspace = withCapabilities({
      supportedScopes: ["build", "workspace"],
    });

    expect(runtimeSupportsRole(OPENCODE_RUNTIME_DESCRIPTOR, "planner")).toBe(true);
    expect(runtimeSupportsRole(OPENCODE_RUNTIME_DESCRIPTOR, "qa")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "spec")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "planner")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "qa")).toBe(false);
    expect(runtimeSupportsRole(buildAndWorkspace, "build")).toBe(true);
    expect(filterRuntimeDefinitionsForRole([workspaceOnly, buildAndWorkspace], "build")).toEqual([
      buildAndWorkspace,
    ]);
    expect(filterRuntimeDefinitionsForDefaultSelection([workspaceOnly, buildAndWorkspace])).toEqual(
      [],
    );
    expect(filterRuntimeDefinitionsForDefaultSelection([OPENCODE_RUNTIME_DESCRIPTOR])).toEqual([
      OPENCODE_RUNTIME_DESCRIPTOR,
    ]);
  });
});
