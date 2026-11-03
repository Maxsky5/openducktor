import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { CodexAppServerChildTransport } from "./codex-app-server-transport-types";
import { createCodexExecutableProbe, verifyCodexAppServerProtocol } from "./codex-executable-probe";

type CodexProbeTransport = Pick<
  CodexAppServerChildTransport,
  "close" | "notify" | "rejectPendingRequestsForShutdown" | "request"
>;

describe("verifyCodexAppServerProtocol", () => {
  test("completes the app-server initialize handshake", async () => {
    const calls: unknown[] = [];
    const transport: CodexProbeTransport = {
      request(input) {
        calls.push(input);
        return Effect.succeed({
          userAgent: "codex",
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
        });
      },
      notify(input) {
        calls.push(input);
        return Effect.void;
      },
      close: () => Effect.void,
      rejectPendingRequestsForShutdown: () => Effect.void,
    };

    await Effect.runPromise(
      verifyCodexAppServerProtocol(transport, "1.2.3", "/usr/local/bin/codex"),
    );

    expect(calls).toEqual([
      {
        method: "initialize",
        params: {
          clientInfo: {
            name: "openducktor",
            title: "OpenDucktor",
            version: "1.2.3",
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
            optOutNotificationMethods: [],
          },
        },
      },
      { method: "initialized" },
    ]);
  });

  test("fails when the selected executable does not answer the Codex protocol", async () => {
    let notified = false;
    const transport: CodexProbeTransport = {
      request: () =>
        Effect.fail(
          new HostValidationError({
            message: "invalid protocol response",
          }),
        ),
      notify: () => {
        notified = true;
        return Effect.void;
      },
      close: () => Effect.void,
      rejectPendingRequestsForShutdown: () => Effect.void,
    };

    const failure = await Effect.runPromise(
      Effect.flip(verifyCodexAppServerProtocol(transport, "1.2.3", "/usr/local/bin/codex")),
    );

    expect(failure._tag).toBe("RuntimeExecutableIncompatibleError");
    expect(notified).toBe(false);
  });

  test("reports the stderr of a Codex process that stops before initialization", async () => {
    const transport: CodexProbeTransport = {
      request: () =>
        Effect.fail(
          new HostOperationError({
            operation: "codexAppServerTransport.childProcess",
            message:
              "Codex app-server closed: process exited with code 1 for runtime executable-probe-1: Error loading configuration",
            details: { runtimeId: "executable-probe-1", stderr: "Error loading configuration" },
          }),
        ),
      notify: () => Effect.void,
      close: () => Effect.void,
      rejectPendingRequestsForShutdown: () => Effect.void,
    };

    const failure = await Effect.runPromise(
      Effect.flip(verifyCodexAppServerProtocol(transport, "1.2.3", "/usr/local/bin/codex")),
    );

    expect(failure.message).toBe(
      "Codex at '/usr/local/bin/codex' did not start: Error loading configuration. OpenDucktor needs a Codex version with the `codex app-server` command. Fix the reported problem, or update Codex to the latest version, for example with `npm install -g @openai/codex@latest`. Then try again.",
    );
  });

  test("keeps operational initialization failures apart from incompatible executables", async () => {
    const operationFailure = new HostOperationError({
      operation: "codexAppServerTransport.request.initialize",
      message: "initialize request timed out",
    });
    const transport: CodexProbeTransport = {
      request: () => Effect.fail(operationFailure),
      notify: () => Effect.void,
      close: () => Effect.void,
      rejectPendingRequestsForShutdown: () => Effect.void,
    };

    const failure = await Effect.runPromise(
      Effect.flip(verifyCodexAppServerProtocol(transport, "1.2.3", "/usr/local/bin/codex")),
    );

    expect(failure).toMatchObject({
      _tag: "HostOperationError",
      operation: "codexExecutableProbe.initialize",
      cause: operationFailure,
    });
    expect(failure.message).toContain("did not start: initialize request timed out.");
  });
});

describe("createCodexExecutableProbe", () => {
  test("returns a typed failure when the selected executable cannot spawn", async () => {
    const probe = createCodexExecutableProbe();

    const exit = await Effect.runPromiseExit(
      probe.probeExecutable(`openducktor-missing-codex-probe-${process.pid}`),
    );

    expect(exit._tag).toBe("Failure");
  });
});
