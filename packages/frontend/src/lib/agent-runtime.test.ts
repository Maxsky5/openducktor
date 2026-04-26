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

  test("accepts runtimes that cover at least one role-specific workflow scope set", () => {
    const workspaceOnly = withCapabilities({
      supportedScopes: ["workspace"],
    });
    const taskOnly = withCapabilities({
      supportedScopes: ["task"],
    });
    const buildAndWorkspace = withCapabilities({
      supportedScopes: ["build", "workspace"],
    });

    expect(getRuntimeDescriptorCapabilityConfigErrors(workspaceOnly)).toEqual([]);
    expect(validateRuntimeDefinitionForOpenDucktor(workspaceOnly)).toEqual([]);
    expect(validateRuntimeDefinitionForOpenDucktor(taskOnly)).toEqual([]);
    expect(validateRuntimeDefinitionForOpenDucktor(buildAndWorkspace)).toEqual([]);
  });

  test("reports runtimes that cannot satisfy any agent role", () => {
    const descriptor = withCapabilities({
      supportedScopes: ["build"],
    });

    expect(getRuntimeDescriptorCapabilityConfigErrors(descriptor)).toEqual([
      "missing workflow scopes for every agent role: spec requires workspace; planner requires workspace; qa requires task; build requires build, workspace",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([
      "missing workflow scopes for every agent role: spec requires workspace; planner requires workspace; qa requires task; build requires build, workspace",
    ]);
  });

  test("reports incompatible runtime definitions with runtime-specific context", () => {
    const descriptor = withCapabilities({
      supportsOdtWorkflowTools: false,
      supportedScopes: ["workspace"],
    });

    expect(validateRuntimeDefinitionsForOpenDucktor([descriptor])).toEqual([
      "Runtime 'opencode' is incompatible with OpenDucktor: missing mandatory capabilities: supportsOdtWorkflowTools",
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
    const taskOnly = withCapabilities({
      supportedScopes: ["task"],
    });

    expect(runtimeSupportsRole(OPENCODE_RUNTIME_DESCRIPTOR, "planner")).toBe(true);
    expect(runtimeSupportsRole(OPENCODE_RUNTIME_DESCRIPTOR, "qa")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "spec")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "planner")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "qa")).toBe(false);
    expect(runtimeSupportsRole(taskOnly, "qa")).toBe(true);
    expect(runtimeSupportsRole(taskOnly, "build")).toBe(false);
    expect(runtimeSupportsRole(buildAndWorkspace, "build")).toBe(true);
    expect(filterRuntimeDefinitionsForRole([workspaceOnly, taskOnly], "qa")).toEqual([taskOnly]);
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
