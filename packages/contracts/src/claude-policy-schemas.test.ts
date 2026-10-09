import { describe, expect, test } from "bun:test";
import { agentRuntimesSchema, persistedGlobalConfigV4Schema } from "./config-schemas";
import {
  claudePolicyFieldsSchema,
  resolveClaudePolicy,
  validateClaudePermissionRule,
} from "./claude-policy-schemas";

describe("Claude policy contracts", () => {
  test.each([{ Task: false }, { Task: false, Agent: true }, { Agent: true, Task: false }])(
    "uses one Agent choice for native aliases without changing saved settings: %j",
    (choices) => {
      const config = agentRuntimesSchema.parse({
        claude: {
          enabled: true,
          executablePath: "",
          defaults: { toolAvailability: { ...choices, FutureTool: false } },
        },
      }).claude;
      const saved = structuredClone(config);
      expect(resolveClaudePolicy(config).settings.toolAvailability).toEqual({
        Agent: false,
        FutureTool: false,
      });
      expect(config).toEqual(saved);
      config.roleOverrides.qa = { toolAvailability: { Task: true } };
      expect(resolveClaudePolicy(config, "qa").settings.toolAvailability).toEqual({ Agent: true });
    },
  );
  test("initializes Artifact exclusions and replaces complete maps for explicit defaults and roles", () => {
    const config = agentRuntimesSchema.parse({}).claude;
    expect(resolveClaudePolicy(config, "build").settings.toolAvailability).toEqual({
      Artifact: false,
      ArtifactComments: false,
      ArtifactData: false,
    });
    config.defaults.toolAvailability = { Artifact: true, FutureTool: false };
    expect(resolveClaudePolicy(config, "qa").settings.toolAvailability).toEqual({
      Artifact: true,
      FutureTool: false,
    });
    config.roleOverrides.qa = { toolAvailability: {}, permissions: { deny: ["Write"] } };
    const explicit = resolveClaudePolicy(config, "qa");
    expect(explicit.settings.toolAvailability).toEqual({});
    expect(explicit.sources.toolAvailability).toBe("role");
    delete config.roleOverrides.qa.toolAvailability;
    const inherited = resolveClaudePolicy(config, "qa");
    expect(inherited.settings.toolAvailability).toEqual({ Artifact: true, FutureTool: false });
    expect(inherited.settings.permissions?.deny).toEqual(["Write"]);
    expect(inherited.sources.toolAvailability).toBe("default");
    const persisted = persistedGlobalConfigV4Schema.parse({
      version: 4,
      agentRuntimes: { claude: config },
    });
    expect(persisted.agentRuntimes.claude.defaults.toolAvailability).toEqual(
      config.defaults.toolAvailability,
    );
  });
  test.each(["", "Read(*)", "B*", "?", " Read", "Re ad", "Read\0", "mcp__odt__odt_read_task"])(
    "rejects availability key %s",
    (name) => {
      expect(
        claudePolicyFieldsSchema.safeParse({ toolAvailability: { [name]: false } }).success,
      ).toBe(false);
    },
  );
  test("loads old configuration with native inheritance and rejects invalid present fields", () => {
    expect(
      agentRuntimesSchema.parse({ claude: { enabled: true, executablePath: "/bin/claude" } })
        .claude,
    ).toEqual({ enabled: true, executablePath: "/bin/claude", defaults: {}, roleOverrides: {} });
    expect(
      persistedGlobalConfigV4Schema.safeParse({
        version: 4,
        agentRuntimes: {
          claude: { enabled: true, executablePath: "", defaults: { permissionMode: "plan" } },
        },
      }).success,
    ).toBe(false);
  });
  test("replaces each role list, keeps sibling defaults, and preserves false and empty values", () => {
    const config = {
      defaults: {
        permissionMode: "auto" as const,
        permissions: { allow: ["Read"], ask: ["Bash"] },
        sandbox: {
          enabled: true,
          filesystem: { allowWrite: ["./src"], denyRead: ["~/.ssh"] },
          network: { strictAllowlist: true },
        },
      },
      roleOverrides: {
        qa: {
          permissions: { allow: [] },
          sandbox: { enabled: false, filesystem: { allowWrite: [] } },
        },
      },
    };
    const resolved = resolveClaudePolicy(config, "qa");
    expect(resolved.settings).toEqual({
      toolAvailability: { Artifact: false, ArtifactComments: false, ArtifactData: false },
      permissionMode: "auto",
      permissions: { allow: [], ask: ["Bash"] },
      sandbox: {
        enabled: false,
        filesystem: { allowWrite: [], denyRead: ["~/.ssh"] },
        network: { strictAllowlist: true },
      },
    });
    expect(resolved.sources["sandbox.enabled"]).toBe("role");
    expect(resolved.sources["sandbox.network.allowAllUnixSockets"]).toBe("native");
    expect(resolved.sources["sandbox.filesystem.denyRead"]).toBe("default");
    config.roleOverrides.qa.permissions = {};
    expect(resolveClaudePolicy(config, "qa").settings.permissions?.allow).toEqual(["Read"]);
    expect(resolveClaudePolicy(config).settings).toMatchObject(config.defaults);
  });
  test.each([
    "Read",
    "Bash(git status)",
    "Bash(echo $(date))",
    "Read(./Finance (2024)/**)",
    "Edit(//tmp/**)",
    "WebFetch(domain:*.example.com)",
    "mcp__future-server__get_*",
    "Agent(custom-agent)",
  ])("preserves native rule %s", (rule) => {
    expect(validateClaudePermissionRule(rule, "deny")).toBeNull();
  });
  test.each([
    "",
    "Read()",
    "Read(foo",
    "mcp__github__get_issue(x)",
    "Write(./src/**)",
    "WebFetch(https://example.com)",
    "Bash(command:rm *)",
  ])("rejects ignored or malformed rule %s", (rule) => {
    expect(validateClaudePermissionRule(rule, "deny")).not.toBeNull();
  });
  test("restricts allow globs to fixed MCP servers and reports an entry's field path", () => {
    expect(validateClaudePermissionRule("mcp__future__get_*", "allow")).toBeNull();
    for (const rule of ["*", "B*", "mcp__*", "mcp__*__get_issue"])
      expect(validateClaudePermissionRule(rule, "allow")).not.toBeNull();
    expect(validateClaudePermissionRule("mcp__*", "ask")).toBeNull();
    const result = claudePolicyFieldsSchema.safeParse({ permissions: { ask: ["Read", "Read()"] } });
    if (result.success) throw new Error("Expected invalid rule");
    expect(result.error.issues[0]?.path).toEqual(["permissions", "ask", 1]);
  });
});
