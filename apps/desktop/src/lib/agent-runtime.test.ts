import { describe, expect, test } from "bun:test";
import type { RuntimeDescriptor } from "@openducktor/contracts";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import {
  filterRuntimeDefinitionsForDefaultSelection,
  filterRuntimeDefinitionsForRole,
  getMissingMandatoryRuntimeCapabilities,
  runtimeSupportsRole,
  validateRuntimeDefinitionForOpenDucktor,
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

  test("filters runtimes by role-scoped provisioning support", () => {
    const workspaceOnly = withCapabilities({
      supportedScopes: ["workspace"],
    });
    const buildOnly = withCapabilities({
      supportedScopes: ["build"],
    });
    const buildAndWorkspace = withCapabilities({
      supportedScopes: ["build", "workspace"],
    });

    expect(runtimeSupportsRole(workspaceOnly, "planner")).toBe(true);
    expect(runtimeSupportsRole(workspaceOnly, "qa")).toBe(false);
    expect(runtimeSupportsRole(buildOnly, "build")).toBe(false);
    expect(runtimeSupportsRole(buildAndWorkspace, "build")).toBe(true);
    expect(
      filterRuntimeDefinitionsForRole([workspaceOnly, buildOnly, buildAndWorkspace], "build"),
    ).toEqual([buildAndWorkspace]);
    expect(filterRuntimeDefinitionsForDefaultSelection([workspaceOnly, buildOnly])).toEqual([]);
    expect(filterRuntimeDefinitionsForDefaultSelection([OPENCODE_RUNTIME_DESCRIPTOR])).toEqual([
      OPENCODE_RUNTIME_DESCRIPTOR,
    ]);
  });
});
