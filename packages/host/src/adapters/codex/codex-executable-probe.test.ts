import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { CodexAppServerChildTransport } from "./codex-app-server-transport-types";
import { createCodexExecutableProbe, verifyCodexAppServerProtocol } from "./codex-executable-probe";

type CodexProbeTransport = Pick<
  CodexAppServerChildTransport,
  "close" | "notify" | "rejectPendingRequestsForShutdown" | "request"
>;

describe("verifyCodexAppServerProtocol", () => {
  test("completes the app-server initialize handshake", async () => {
    const calls: unknown[] = [];
    const transport = {
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
    } as CodexProbeTransport;

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
    const transport = {
      request: () =>
        Effect.fail(
          new HostOperationError({
            operation: "codexAppServerTransport.request.initialize",
            message: "invalid protocol response",
          }),
        ),
      notify: () => {
        notified = true;
        return Effect.void;
      },
      close: () => Effect.void,
      rejectPendingRequestsForShutdown: () => Effect.void,
    } as unknown as CodexProbeTransport;

    const exit = await Effect.runPromiseExit(verifyCodexAppServerProtocol(transport, "1.2.3"));

    expect(exit._tag).toBe("Failure");
    expect(notified).toBe(false);
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
