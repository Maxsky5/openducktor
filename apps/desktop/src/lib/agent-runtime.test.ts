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

  test("only fully supported runtimes remain eligible for role and default selection", () => {
    const workspaceOnly = withCapabilities({
      supportedScopes: ["workspace"],
    });
    const buildAndWorkspace = withCapabilities({
      supportedScopes: ["build", "workspace"],
    });

    expect(runtimeSupportsRole(OPENCODE_RUNTIME_DESCRIPTOR, "planner")).toBe(true);
    expect(runtimeSupportsRole(OPENCODE_RUNTIME_DESCRIPTOR, "qa")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "qa")).toBe(false);
    expect(runtimeSupportsRole(buildAndWorkspace, "build")).toBe(false);
    expect(filterRuntimeDefinitionsForRole([workspaceOnly, buildAndWorkspace], "build")).toEqual(
      [],
    );
    expect(filterRuntimeDefinitionsForDefaultSelection([workspaceOnly, buildAndWorkspace])).toEqual(
      [],
    );
    expect(filterRuntimeDefinitionsForDefaultSelection([OPENCODE_RUNTIME_DESCRIPTOR])).toEqual([
      OPENCODE_RUNTIME_DESCRIPTOR,
    ]);
  });
});
