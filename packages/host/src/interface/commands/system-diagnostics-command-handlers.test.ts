import type { SystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { createHostCommandRouter } from "../router/host-command-router";
import { createSystemDiagnosticsCommandHandlers } from "./system-diagnostics-command-handlers";

const createDiagnosticsService = (): SystemDiagnosticsService =>
  ({
    runtimeCheck: async (forceRefresh: boolean | undefined) => ({ forceRefresh }),
    beadsCheck: async (repoPath: string) => ({ repoPath }),
    systemCheck: async (repoPath: string) => ({ repoPath }),
  }) as unknown as SystemDiagnosticsService;

describe("createSystemDiagnosticsCommandHandlers", () => {
  test("routes diagnostics commands to the service", async () => {
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(createDiagnosticsService()),
    });

    await expect(router.invoke("runtime_check", { force: true })).resolves.toEqual({
      forceRefresh: true,
    });
    await expect(router.invoke("beads_check", { repoPath: "/repo" })).resolves.toEqual({
      repoPath: "/repo",
    });
    await expect(router.invoke("system_check", { repoPath: "/repo" })).resolves.toEqual({
      repoPath: "/repo",
    });
  });

  test("requires repoPath for repo-scoped diagnostics", async () => {
    const router = createHostCommandRouter({
      handlers: createSystemDiagnosticsCommandHandlers(createDiagnosticsService()),
    });

    await expect(router.invoke("beads_check", {})).rejects.toThrow("repoPath is required.");
    await expect(router.invoke("system_check")).rejects.toThrow(
      "system_check input must be an object.",
    );
  });
});
