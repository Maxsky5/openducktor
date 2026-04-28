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
    expect(OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow.supportedScopes).toEqual(
      requiredRuntimeSupportedScopes,
    );
  });

  test("reports workflow and baseline compatibility errors by requirement class", () => {
    const descriptor = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportsOdtWorkflowTools: false,
      },
    });

    expect(getMissingMandatoryRuntimeCapabilities(descriptor)).toEqual([
      "workflow.supportsOdtWorkflowTools",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([
      "[workflow] missing OpenDucktor workflow tool support",
    ]);
  });

  test("accepts optional capability combinations without extra invariants", () => {
    const descriptor = withCapabilities({
      optionalSurfaces: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.optionalSurfaces,
        supportsProfiles: true,
        supportsMcpStatus: false,
      },
      promptInput: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.promptInput,
        supportsSlashCommands: true,
      },
    });

    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([]);
  });

  test("fails fast on runtime descriptor schema violations before registration", () => {
    const invariantViolation = {
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      capabilities: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
        sessionLifecycle: {
          ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
          supportedStartModes: ["fresh", "reuse"],
          supportsSessionFork: false,
          forkTargets: [],
        },
        promptInput: {
          ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.promptInput,
          supportsFileSearch: true,
          supportedParts: ["text"],
        },
      },
    } as unknown as RuntimeDescriptor;

    expect(validateRuntimeDefinitionForOpenDucktor(invariantViolation)).toEqual([
      "[optional_enhancement] runtime descriptor schema violation at capabilities.promptInput.supportedParts: Runtime descriptors that support slash commands must declare slash command prompt parts.",
      "[optional_enhancement] runtime descriptor schema violation at capabilities.promptInput.supportedParts: Runtime descriptors that support file search must declare file or folder prompt references.",
    ]);

    const staleFlatCapability = {
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      capabilities: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
        supportsFileSearch: true,
      },
    } as unknown as RuntimeDescriptor;

    expect(validateRuntimeDefinitionForOpenDucktor(staleFlatCapability)).toEqual([
      '[baseline] runtime descriptor schema violation at capabilities: Unrecognized key: "supportsFileSearch"',
    ]);
  });

  test("returns schema errors instead of crashing for partially migrated descriptors", () => {
    const malformedDescriptor = {
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      capabilities: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
        workflow: undefined,
      },
    } as unknown as RuntimeDescriptor;

    expect(() => validateRuntimeDefinitionForOpenDucktor(malformedDescriptor)).not.toThrow();
    expect(validateRuntimeDefinitionForOpenDucktor(malformedDescriptor)).toEqual([
      "[baseline] runtime descriptor schema violation at capabilities.workflow: Invalid input: expected object, received undefined",
    ]);
  });

  test("reports runtimes that only cover a partial role-specific workflow scope set", () => {
    const workspaceOnly = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["workspace"],
      },
    });
    const taskOnly = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["task"],
      },
    });
    const buildAndWorkspace = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["build", "workspace"],
      },
    });

    expect(getRuntimeDescriptorCapabilityConfigErrors(workspaceOnly)).toEqual([
      "[role_scoped] missing required workflow scopes: task, build",
      "[role_scoped] unsupported agent roles: qa, build (spec requires workspace; planner requires workspace; qa requires task; build requires build, workspace)",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(taskOnly)).toEqual([
      "[role_scoped] missing required workflow scopes: workspace, build",
      "[role_scoped] unsupported agent roles: spec, planner, build (spec requires workspace; planner requires workspace; qa requires task; build requires build, workspace)",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(buildAndWorkspace)).toEqual([
      "[role_scoped] missing required workflow scopes: task",
      "[role_scoped] unsupported agent roles: qa (spec requires workspace; planner requires workspace; qa requires task; build requires build, workspace)",
    ]);
  });

  test("reports runtimes that cannot satisfy any agent role", () => {
    const descriptor = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["build"],
      },
    });

    expect(getRuntimeDescriptorCapabilityConfigErrors(descriptor)).toEqual([
      "[role_scoped] missing required workflow scopes: workspace, task",
      "[role_scoped] unsupported agent roles: spec, planner, qa, build (spec requires workspace; planner requires workspace; qa requires task; build requires build, workspace)",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([
      "[role_scoped] missing required workflow scopes: workspace, task",
      "[role_scoped] unsupported agent roles: spec, planner, qa, build (spec requires workspace; planner requires workspace; qa requires task; build requires build, workspace)",
    ]);
  });

  test("reports scenario-scoped start mode gaps separately from role scopes", () => {
    const descriptor = withCapabilities({
      sessionLifecycle: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
        supportedStartModes: ["fresh", "reuse"],
        supportsSessionFork: false,
        forkTargets: [],
      },
    });

    expect(getRuntimeDescriptorCapabilityConfigErrors(descriptor)).toContain(
      "[scenario_scoped] scenario build_pull_request_generation requires start modes: fork",
    );
  });

  test("reports incompatible runtime definitions with runtime-specific context", () => {
    const descriptor = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportsOdtWorkflowTools: false,
      },
    });

    expect(validateRuntimeDefinitionsForOpenDucktor([descriptor])).toEqual([
      "Runtime 'opencode' is incompatible with OpenDucktor: [workflow] missing OpenDucktor workflow tool support",
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
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["workspace"],
      },
    });
    const buildAndWorkspace = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["build", "workspace"],
      },
    });
    const taskOnly = withCapabilities({
      workflow: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.workflow,
        supportedScopes: ["task"],
      },
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
