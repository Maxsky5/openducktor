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

    await Effect.runPromise(verifyCodexAppServerProtocol(transport, "1.2.3"));

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
      Effect.flip(verifyCodexAppServerProtocol(transport, "1.2.3")),
    );

    expect(failure._tag).toBe("RuntimeExecutableIncompatibleError");
    expect(notified).toBe(false);
  });

  test("preserves operational initialization failures", async () => {
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
      Effect.flip(verifyCodexAppServerProtocol(transport, "1.2.3")),
    );

    expect(failure).toBe(operationFailure);
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
