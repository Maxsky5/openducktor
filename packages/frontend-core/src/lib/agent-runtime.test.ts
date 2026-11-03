import { builtinTaskWorkflow } from "@openducktor/workflows";

import { describe, expect, test } from "bun:test";
import type { RuntimeDescriptor } from "@openducktor/contracts";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import {
  filterRuntimeDefinitionsForDefaultSelection,
  filterRuntimeDefinitionsForRole,
  filterRuntimeDefinitionsForStartMode,
  getAvailableRuntimeDefinitions,
  getAvailableRuntimeDefinitionsForStartMode,
  getMissingMandatoryRuntimeCapabilities,
  getRuntimeDescriptorCapabilityConfigErrors,
  resolveRuntimeKindSelection,
  resolveRuntimeKindSelectionState,
  runtimeSupportsCapability,
  runtimeSupportsRole,
  runtimeSupportsStartMode,
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
  test("lets the OpenCode descriptor cover every required workflow scope", () => {
    expect(
      builtinTaskWorkflow.definition.roles.filter(
        (role) => !runtimeSupportsRole(OPENCODE_RUNTIME_DESCRIPTOR, role),
      ),
    ).toEqual([]);
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

  test("requires read-only auto-reject safety as workflow compatibility", () => {
    const descriptor = withCapabilities({
      approvals: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.approvals,
        readOnlyAutoRejectSafe: false,
      },
    });

    expect(getMissingMandatoryRuntimeCapabilities(descriptor)).toEqual([
      "approvals.readOnlyAutoRejectSafe",
    ]);
    expect(getRuntimeDescriptorCapabilityConfigErrors(descriptor)).toEqual([
      "[workflow] read-only roles must auto-reject mutating approval requests",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([
      "[workflow] runtime descriptor schema violation at capabilities.approvals.readOnlyAutoRejectSafe: Read-only roles must auto-reject mutating approval requests.",
    ]);
  });

  test("accepts optional capability combinations without extra invariants", () => {
    const descriptor = withCapabilities({
      optionalSurfaces: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.optionalSurfaces,
        supportsProfiles: true,
        supportsMcpStatus: false,
        supportsImageGeneration: false,
      },
      promptInput: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.promptInput,
        supportsSlashCommands: true,
      },
    });

    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([]);
  });

  test("resolves optional runtime capability support from the descriptor", () => {
    const runtimeWithTodos = withCapabilities({
      optionalSurfaces: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.optionalSurfaces,
        supportsTodos: true,
      },
    });
    const runtimeWithoutTodos = withCapabilities({
      optionalSurfaces: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.optionalSurfaces,
        supportsTodos: false,
      },
    });

    expect(runtimeSupportsCapability(runtimeWithTodos, "optionalSurfaces.supportsTodos")).toBe(
      true,
    );
    expect(runtimeSupportsCapability(runtimeWithoutTodos, "optionalSurfaces.supportsTodos")).toBe(
      false,
    );
    expect(
      runtimeSupportsCapability(runtimeWithTodos, "promptInput.supportsSubagentReferences"),
    ).toBe(true);
  });

  test("fails fast on runtime descriptor schema violations before registration", () => {
    const invariantViolation: RuntimeDescriptor = {
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
          supportsSkillReferences: false,
          supportsSubagentReferences: false,
        },
      },
    };

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
    };

    expect(validateRuntimeDefinitionForOpenDucktor(staleFlatCapability)).toEqual([
      '[baseline] runtime descriptor schema violation at capabilities: Unrecognized key: "supportsFileSearch"',
    ]);
  });

  test("returns schema errors instead of crashing for partially migrated descriptors", () => {
    const malformedDescriptor: RuntimeDescriptor = {
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      capabilities: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities,
        // @ts-expect-error -- This fixture verifies runtime rejection of a missing workflow contract.
        workflow: undefined,
      },
    };

    expect(() => validateRuntimeDefinitionForOpenDucktor(malformedDescriptor)).not.toThrow();
    expect(validateRuntimeDefinitionForOpenDucktor(malformedDescriptor)).toEqual([
      "[baseline] runtime descriptor schema violation at capabilities.workflow: Invalid input: expected object, received undefined",
    ]);
  });

  test("classifies item-level history fidelity invariants as launch-scoped", () => {
    const descriptor = withCapabilities({
      history: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.history,
        fidelity: "item",
        stableItemIds: false,
        exposesCompletionState: false,
      },
    });

    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([
      "[launch_scoped] runtime descriptor schema violation at capabilities.history.stableItemIds: Runtime descriptors with item-level history fidelity must expose stable item IDs.",
      "[launch_scoped] runtime descriptor schema violation at capabilities.history.exposesCompletionState: Runtime descriptors with item-level history fidelity must expose item completion state.",
    ]);
  });

  test("classifies fork target invariants as launch-scoped", () => {
    const descriptor = withCapabilities({
      sessionLifecycle: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
        supportedStartModes: ["fresh", "reuse", "fork"],
        supportsSessionFork: true,
        forkTargets: [],
      },
    });

    expect(validateRuntimeDefinitionForOpenDucktor(descriptor)).toEqual([
      "[launch_scoped] runtime descriptor schema violation at capabilities.sessionLifecycle.forkTargets: Runtime descriptors that support session forks must declare at least one fork target.",
    ]);
  });

  test("prefers shared capability class mappings over broad schema path fallbacks", () => {
    const approvalDescriptor = withCapabilities({
      approvals: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.approvals,
        supportedRequestTypes: ["command_execution"],
        supportedReplyOutcomes: ["reject"],
      },
    });
    const malformedCapabilities: Partial<RuntimeDescriptor["capabilities"]> = {
      structuredInput: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.structuredInput,
        // @ts-expect-error -- This fixture verifies runtime rejection of a non-boolean capability.
        supportsQuestions: "yes",
      },
    };
    const structuredInputDescriptor = withCapabilities(malformedCapabilities);

    expect(validateRuntimeDefinitionForOpenDucktor(approvalDescriptor)).toEqual([
      "[workflow] runtime descriptor schema violation at capabilities.approvals.supportedReplyOutcomes: Runtime descriptors with approval requests must support at least one approval reply outcome.",
    ]);
    expect(validateRuntimeDefinitionForOpenDucktor(structuredInputDescriptor)).toEqual([
      "[workflow] runtime descriptor schema violation at capabilities.structuredInput.supportsQuestions: Invalid input: expected boolean, received string",
    ]);
  });

  test("filters runtime definitions by the selected start mode", () => {
    const reuseRuntime = withCapabilities({
      sessionLifecycle: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
        supportedStartModes: ["fresh", "reuse"],
        supportsSessionFork: false,
        forkTargets: [],
      },
    });
    const forkRuntime = {
      ...withCapabilities({
        sessionLifecycle: {
          ...OPENCODE_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
          supportedStartModes: ["fresh", "fork"],
          supportsSessionFork: true,
          forkTargets: ["session"],
        },
      }),
      kind: "codex" as const,
      label: "Fork Runtime",
    };

    expect(runtimeSupportsStartMode(reuseRuntime, "reuse")).toBe(true);
    expect(runtimeSupportsStartMode(reuseRuntime, "fork")).toBe(false);
    expect(filterRuntimeDefinitionsForStartMode([reuseRuntime, forkRuntime], "reuse")).toEqual([
      reuseRuntime,
    ]);
    expect(filterRuntimeDefinitionsForStartMode([reuseRuntime, forkRuntime], "fork")).toEqual([
      forkRuntime,
    ]);
  });

  test("resolves available runtimes from enabled runtime settings", () => {
    expect(
      getAvailableRuntimeDefinitions({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        agentRuntimes: {
          opencode: {
            defaults: { rules: [] },
            roleOverrides: {},
            enabled: false,
            executablePath: "",
          },
          codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: true },
          claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
        },
      }).map((definition) => definition.kind),
    ).toEqual(["codex"]);

    expect(
      getAvailableRuntimeDefinitionsForStartMode({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        agentRuntimes: {
          opencode: {
            defaults: { rules: [] },
            roleOverrides: {},
            enabled: true,
            executablePath: "/bin/opencode",
          },
          codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false },
          claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
        },
        startMode: "fresh",
      }).map((definition) => definition.kind),
    ).toEqual(["opencode"]);

    expect(
      getAvailableRuntimeDefinitions({
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
        agentRuntimes: {
          opencode: {
            defaults: { rules: [] },
            roleOverrides: {},
            enabled: false,
            executablePath: "",
          },
          codex: { ...DEFAULT_AGENT_RUNTIMES.codex, enabled: false },
          claude: { enabled: false, executablePath: "", defaults: {}, roleOverrides: {} },
        },
      }).map((definition) => definition.kind),
    ).toEqual([]);
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
    const codex = CODEX_RUNTIME_DESCRIPTOR;

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
    ).toEqual({
      status: "unknown-request",
      runtimeKind: null,
      requestedRuntimeKind: "codex",
    });
    expect(
      resolveRuntimeKindSelectionState({
        runtimeDefinitions: [],
        requestedRuntimeKind: "codex",
      }),
    ).toEqual({
      status: "no-definitions",
      runtimeKind: null,
      requestedRuntimeKind: "codex",
    });
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

    expect(
      runtimeSupportsRole(
        OPENCODE_RUNTIME_DESCRIPTOR,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "planner")!,
      ),
    ).toBe(true);
    expect(
      runtimeSupportsRole(
        OPENCODE_RUNTIME_DESCRIPTOR,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "qa")!,
      ),
    ).toBe(true);
    expect(
      runtimeSupportsRole(
        workspaceOnly,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "spec")!,
      ),
    ).toBe(true);
    expect(
      runtimeSupportsRole(
        workspaceOnly,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "planner")!,
      ),
    ).toBe(true);
    expect(
      runtimeSupportsRole(
        workspaceOnly,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "qa")!,
      ),
    ).toBe(false);
    expect(
      runtimeSupportsRole(
        taskOnly,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "qa")!,
      ),
    ).toBe(true);
    expect(
      runtimeSupportsRole(
        taskOnly,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "build")!,
      ),
    ).toBe(false);
    expect(
      runtimeSupportsRole(
        buildAndWorkspace,
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "build")!,
      ),
    ).toBe(true);
    expect(
      filterRuntimeDefinitionsForRole(
        [workspaceOnly, taskOnly],
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "qa")!,
      ),
    ).toEqual([taskOnly]);
    expect(
      filterRuntimeDefinitionsForRole(
        [workspaceOnly, buildAndWorkspace],
        builtinTaskWorkflow.definition.roles.find(({ id }) => id === "build")!,
      ),
    ).toEqual([buildAndWorkspace]);
    expect(
      filterRuntimeDefinitionsForDefaultSelection(
        [workspaceOnly, buildAndWorkspace],
        builtinTaskWorkflow.definition.roles,
      ),
    ).toEqual([]);
    expect(
      filterRuntimeDefinitionsForDefaultSelection(
        [OPENCODE_RUNTIME_DESCRIPTOR],
        builtinTaskWorkflow.definition.roles,
      ),
    ).toEqual([OPENCODE_RUNTIME_DESCRIPTOR]);
  });
});
