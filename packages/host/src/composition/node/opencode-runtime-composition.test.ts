import { describe, expect, spyOn, test } from "bun:test";
import {
  OpenCodeOperationError,
  OpencodeSdkAdapter,
  type ReadOpencodeDirectory,
} from "@openducktor/adapters-opencode-sdk";
import { Effect } from "effect";
import { createTaskSessionLifecycleCoordinator } from "../../application/tasks/worktrees/task-session-lifecycle-coordinator";
import { HostOperationError } from "../../effect/host-errors";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createOpenCodeRuntimeComposition } from "./opencode-runtime-composition";

const sessionRuntime: Pick<
  typeof import("@openducktor/adapters-opencode-sdk"),
  "createPrepareOpencodeSessionRuntime"
> = await import(
  new URL("../../../../adapters-opencode-sdk/src/opencode-session-runtime.ts", import.meta.url).href
);
const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  externalSessionId: "ses_saved",
};

const createReadDirectory = (): ReadOpencodeDirectory => {
  let readDirectory: ReadOpencodeDirectory | undefined;
  const prepareRuntime = sessionRuntime.createPrepareOpencodeSessionRuntime;
  // Capture the production hook without replacing the runtime or leaving a spy across an await.
  const observer = spyOn(sessionRuntime, "createPrepareOpencodeSessionRuntime").mockImplementation(
    (options) => {
      readDirectory = options.readDirectory;
      return prepareRuntime(options);
    },
  );
  try {
    createOpenCodeRuntimeComposition({
      launchDirectory: "/repo",
      liveSessionLifecycle: {
        registerRuntimeAdapter: () => Effect.die("No runtime should register during composition."),
        releaseRuntime: () => Effect.die("No runtime should stop during composition."),
        createRuntimeRegistration: () => {
          throw new Error("No session should register during composition.");
        },
      },
      readEnv: () => ({}),
      resolveMcpServerConfig: () => Effect.die("A session read must not resolve MCP config."),
      settingsConfig: createFixedRuntimeSettingsConfig("opencode", process.execPath),
      taskSessionLifecycleCoordinator: createTaskSessionLifecycleCoordinator(),
      toolDiscovery: {
        discoverTool: () => Effect.die("No tool discovery should run during composition."),
        resolveTool: () => Effect.die("No tool should resolve during composition."),
        resolveToolPath: () => Effect.die("No tool path should resolve during composition."),
        validateToolPath: () => Effect.die("No tool path should validate during composition."),
      },
    });
  } finally {
    observer.mockRestore();
  }
  if (!readDirectory) throw new Error("The composition did not supply a directory guard.");
  return readDirectory;
};

describe("OpenCode runtime composition directory guard", () => {
  test.each([
    {
      stage: "migration",
      code: "migration_blocked",
      nextAction: "Finish native migration in OpenCode, then retry this action.",
    },
    {
      stage: "missing session",
      code: "session_not_found",
      nextAction:
        "Check native migration and the exact conversation in OpenCode, then retry. The saved link is unchanged.",
    },
    {
      stage: "malformed response",
      code: "invalid_runtime_response",
      nextAction:
        "Check OpenCode's reported error and retry this action. Saved links and input are unchanged.",
    },
  ])(
    "preserves actionable $stage failures in session controls",
    async ({ stage, code, nextAction }) => {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const { pathname } = new URL(request.url);
          if (request.method === "GET" && pathname.endsWith("/migration/v1"))
            return Response.json({ status: stage === "migration" ? "required" : "completed" });
          if (request.method === "GET" && pathname === "/api/session/ses_saved") {
            if (stage === "missing session")
              return Response.json(
                {
                  _tag: "SessionNotFoundError",
                  message: "Missing ses_saved",
                  sessionID: "ses_saved",
                },
                { status: 404 },
              );
            return Response.json({
              data: { id: "ses_saved", time: { created: null, updated: 2 } },
            });
          }
          throw new Error(`Unexpected native request ${request.method} ${pathname}`);
        },
      });
      const controller = new OpencodeSdkAdapter(
        {
          runtimeId: "runtime-1",
          endpoint: server.url.origin,
          authentication: { type: "basic", username: "opencode", password: "test-password" },
        },
        { resolveCreationSettings: async () => ({ defaults: [], role: [] }) },
        { readDirectory: createReadDirectory(), ensureMcp: async () => {}, admitted: () => {} },
      );
      try {
        const failure = await controller.stopSession(ref).catch((cause: unknown) => cause);
        expect(failure).toBeInstanceOf(OpenCodeOperationError);
        if (!(failure instanceof OpenCodeOperationError))
          throw new Error("Expected a native failure.");
        const detail = failure.failure.runtimeOperationFailure;
        expect(detail).toMatchObject({
          ...ref,
          operation: "interrupt the conversation",
          code,
          nextAction,
        });
        expect(detail.migration).toEqual(
          stage === "migration" ? { status: "required" } : undefined,
        );
        if (stage === "migration")
          expect(detail.nativeReason).toBe("Native V1 migration is required.");
        if (stage === "missing session") expect(detail.nativeReason).toBe("Missing ses_saved");
      } finally {
        controller.close();
        await server.stop(true);
      }
    },
  );

  test("maps other directory read failures to host operation errors", async () => {
    const failure = new Error("Directory read failed.");
    const result = await createReadDirectory()("/repo", async () => {
      throw failure;
    }).catch((cause: unknown) => cause);
    expect(result).toBeInstanceOf(HostOperationError);
    expect(result).toMatchObject({
      operation: "opencode-live-session.read-directory",
      details: { directory: "/repo" },
      cause: failure,
    });
  });
});
