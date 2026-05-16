import { Effect } from "effect";
import type { SystemDiagnosticsService } from "../../application/diagnostics/system-diagnostics-service";
import { HostOperationError } from "../../effect/host-errors";
import { createHostCommandRouter } from "../router/host-command-router";
import { createSystemDiagnosticsCommandHandlers } from "./system-diagnostics-command-handlers";

const createDiagnosticsService = (): SystemDiagnosticsService =>
  ({
    runtimeCheck: (forceRefresh: boolean | undefined) =>
      Effect.tryPromise({
        try: async () => {
          return { forceRefresh };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
    beadsCheck: (repoPath: string) =>
      Effect.tryPromise({
        try: async () => {
          return { repoPath };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
    systemCheck: (repoPath: string) =>
      Effect.tryPromise({
        try: async () => {
          return { repoPath };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      }),
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
