import { createHostCommandRouter } from "./host-command-router";
import { createRuntimeDefinitionsCommandHandlers } from "./runtime-definitions-command-handlers";
import type { RuntimeDefinitionsService } from "./runtime-definitions-service";

describe("createRuntimeDefinitionsCommandHandlers", () => {
  test("routes runtime_definitions_list through the runtime definitions service", async () => {
    const service: RuntimeDefinitionsService = {
      listRuntimeDefinitions() {
        return [
          {
            kind: "opencode",
            label: "OpenCode",
            description: "OpenCode runtime",
            readOnlyRoleBlockedTools: [],
            workflowToolAliasesByCanonical: {},
            capabilities: {
              provisioningMode: "host_managed",
              workflow: {
                supportsOdtWorkflowTools: true,
                supportedScopes: ["workspace", "task", "build"],
              },
              sessionLifecycle: {
                supportedStartModes: ["fresh"],
              },
              promptInput: {
                supportedParts: ["text"],
              },
              approvals: {
                readOnlyAutoRejectSafe: true,
              },
            },
          },
        ];
      },
    };
    const router = createHostCommandRouter({
      handlers: createRuntimeDefinitionsCommandHandlers(service),
    });

    await expect(router.invoke("runtime_definitions_list", {})).resolves.toMatchObject([
      { kind: "opencode" },
    ]);
  });

  test("rejects malformed runtime definitions args", async () => {
    const service: RuntimeDefinitionsService = {
      listRuntimeDefinitions() {
        throw new Error("should not call runtime definitions service");
      },
    };
    const router = createHostCommandRouter({
      handlers: createRuntimeDefinitionsCommandHandlers(service),
    });

    await expect(router.invoke("runtime_definitions_list", { force: true })).rejects.toThrow(
      "runtime_definitions_list does not accept arguments.",
    );
  });
});
