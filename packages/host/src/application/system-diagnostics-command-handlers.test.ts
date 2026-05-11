import { createHostCommandRouter } from "./host-command-router";
import { createSystemDiagnosticsCommandHandlers } from "./system-diagnostics-command-handlers";
import type { SystemDiagnosticsService } from "./system-diagnostics-service";

const createDiagnosticsService = (): SystemDiagnosticsService => ({
  runtimeCheck: async (forceRefresh) => ({ forceRefresh }),
  beadsCheck: async (repoPath) => ({ repoPath }),
  systemCheck: async (repoPath) => ({ repoPath }),
});

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

    await expect(router.invoke("beads_check", {})).rejects.toThrow(
      "beads_check requires an object argument with repoPath.",
    );
    await expect(router.invoke("system_check")).rejects.toThrow(
      "system_check requires an object argument with repoPath.",
    );
  });
});
