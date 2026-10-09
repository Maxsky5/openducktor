import { describe, expect, test } from "bun:test";
import type { RepoAction, RepoActions } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { TerminalCommandResult } from "../terminals/terminal-command";
import { TerminalServiceError } from "../terminals/terminal-service-error";
import {
  createWorktreeActionRunner,
  type WorktreeActionError,
  type WorktreeActionTerminals,
} from "./worktree-action-runner";

const context = { repoPath: "/repo", taskId: "task-1" };
const target = { worktreePath: "/worktrees/task-1", branch: "odt/task-1" };

const action = (id: string, overrides: Partial<RepoAction> = {}): RepoAction => ({
  id,
  icon: "play",
  name: id,
  command: `run ${id}`,
  runOnWorktreeCreate: true,
  waitBeforeAgentStart: false,
  ...overrides,
});

const actionsOf = (...items: RepoAction[]): RepoActions => ({
  items,
  defaultActionId: items[0]?.id ?? null,
});

const terminalFailure = (code: TerminalServiceError["code"], message: string) =>
  new TerminalServiceError({ code, operation: "close", message });

const makeTerminals = () => {
  const calls: string[] = [];
  const results = new Map<string, Deferred.Deferred<TerminalCommandResult>>();
  const closeFailures = new Map<string, TerminalServiceError>();
  let failStartFor: string | null = null;
  let failOutputTail = false;
  const terminals: WorktreeActionTerminals = {
    startCommandInPreparedTarget: ({
      label,
      commandLines,
      startedBy,
      workingDir,
      context: owner,
    }) =>
      Effect.suspend(() => {
        calls.push(
          `start:${label}:${startedBy}:${workingDir}:${JSON.stringify(owner)}:${commandLines.join("|")}`,
        );
        if (failStartFor === label) {
          return Effect.fail(
            new TerminalServiceError({
              code: "context_terminal_limit",
              operation: "start_command",
              message: "The terminal limit has been reached.",
            }),
          );
        }
        const result = Deferred.makeUnsafe<TerminalCommandResult>();
        results.set(label, result);
        const terminalId = `terminal-${label}`;
        return Effect.succeed({
          response: {
            ref: { terminalId },
            summary: {
              terminalId,
              label,
              context: owner,
              initialWorkingDir: workingDir,
              createdAt: "2026-07-12T00:00:00.000Z",
              lifecycle: "running",
              exit: null,
              startedBy,
            },
          },
          result: Deferred.await(result),
        });
      }),
    readOutputTail: (terminalId, lineCount) =>
      Effect.suspend(() => {
        calls.push(`tail:${terminalId}:${lineCount}`);
        return failOutputTail
          ? Effect.fail(terminalFailure("terminal_not_found", "Terminal is gone."))
          : Effect.succeed(["still installing"]);
      }),
    close: ({ terminalId, confirmTerminate }) =>
      Effect.suspend(() => {
        calls.push(`close:${terminalId}:${confirmTerminate}`);
        const failure = closeFailures.get(terminalId);
        return failure ? Effect.fail(failure) : Effect.void;
      }),
  };
  return {
    terminals,
    calls,
    complete: (name: string, result: TerminalCommandResult) => {
      const deferred = results.get(name);
      if (!deferred) throw new Error(`Action ${name} did not start.`);
      Deferred.doneUnsafe(deferred, Effect.succeed(result));
    },
    failStart: (name: string) => {
      failStartFor = name;
    },
    failOutputTail: () => {
      failOutputTail = true;
    },
    failClose: (terminalId: string, failure: TerminalServiceError | null) => {
      if (failure) closeFailures.set(terminalId, failure);
      else closeFailures.delete(terminalId);
    },
  };
};

const exited = (exitCode: number, outputTail: string[] = [], signal: string | null = null) =>
  ({ type: "exited", exitCode, signal, outputTail }) as const;

const startCalls = (terminals: ReturnType<typeof makeTerminals>) =>
  terminals.calls.filter((call) => call.startsWith("start:"));

const runFailure = async (
  terminals: ReturnType<typeof makeTerminals>,
  actions: RepoActions,
  completeActions: () => void,
): Promise<WorktreeActionError> => {
  const run = createWorktreeActionRunner(terminals.terminals).createRun(target);
  const fiber = Effect.runFork(Effect.flip(run.run({ context, actions })));
  await Bun.sleep(0);
  completeActions();
  return Effect.runPromise(Fiber.join(fiber));
};

const closeCalls = (terminals: ReturnType<typeof makeTerminals>) =>
  terminals.calls.filter((call) => call.startsWith("close:")).sort();

describe("createWorktreeActionRunner", () => {
  test("starts worktree-creation actions in order and waits only for waiting actions", async () => {
    const terminals = makeTerminals();
    const run = createWorktreeActionRunner(terminals.terminals).createRun(target);
    const owner = JSON.stringify(context);
    const fiber = Effect.runFork(
      run.run({
        context,
        actions: actionsOf(
          action("install", {
            waitBeforeAgentStart: true,
            command: "# setup\nbun install\n\n  bun run build  ",
          }),
          action("manual", { runOnWorktreeCreate: false }),
          action("dev"),
          action("build", { waitBeforeAgentStart: true }),
        ),
      }),
    );
    await Bun.sleep(0);
    // The host starts every worktree-creation action.
    expect(startCalls(terminals)).toEqual([
      `start:install:host:/worktrees/task-1:${owner}:bun install|bun run build`,
    ]);
    terminals.complete("install", exited(0));
    await Bun.sleep(0);
    expect(startCalls(terminals)).toEqual([
      `start:install:host:/worktrees/task-1:${owner}:bun install|bun run build`,
      `start:dev:host:/worktrees/task-1:${owner}:run dev`,
      `start:build:host:/worktrees/task-1:${owner}:run build`,
    ]);
    terminals.complete("build", exited(0));
    await Effect.runPromise(Fiber.join(fiber));
    expect(closeCalls(terminals)).toEqual([]);

    await Effect.runPromise(run.stopTerminals());
    expect(closeCalls(terminals)).toEqual([
      "close:terminal-build:true",
      "close:terminal-dev:true",
      "close:terminal-install:true",
    ]);
  });

  test("fails on a non-zero waiting action and skips later actions", async () => {
    const terminals = makeTerminals();
    const failure = await runFailure(
      terminals,
      actionsOf(action("dev"), action("install", { waitBeforeAgentStart: true }), action("later")),
      () => terminals.complete("install", exited(1, ["$ bun install", "error: lockfile"])),
    );

    expect(failure).toMatchObject({
      _tag: "WorktreeActionExitError",
      actionName: "install",
      exitCode: 1,
      signal: null,
      outputTail: ["$ bun install", "error: lockfile"],
      message:
        'Worktree action "install" exited with code 1.\nLast output:\n$ bun install\nerror: lockfile',
    });
    expect(terminals.calls.some((call) => call.startsWith("start:later"))).toBe(false);
  });

  test("fails on a waiting action that a signal stopped with exit code 0", async () => {
    const terminals = makeTerminals();
    const failure = await runFailure(
      terminals,
      actionsOf(action("install", { waitBeforeAgentStart: true })),
      () => terminals.complete("install", exited(0, [], "2")),
    );

    expect(failure).toMatchObject({
      _tag: "WorktreeActionExitError",
      signal: "2",
      message: 'Worktree action "install" stopped with signal 2.',
    });
  });

  test("fails when a waiting action terminal closes before its command ends", async () => {
    const terminals = makeTerminals();
    const failure = await runFailure(
      terminals,
      actionsOf(action("install", { waitBeforeAgentStart: true })),
      () => terminals.complete("install", { type: "closed", outputTail: ["$ bun install"] }),
    );

    expect(failure).toMatchObject({
      _tag: "WorktreeActionTerminalClosedError",
      outputTail: ["$ bun install"],
      message:
        'Worktree action "install" stopped because its terminal closed before the command ended.\nLast output:\n$ bun install',
    });
  });

  test("reports a terminal failure with its reason and output", async () => {
    const terminals = makeTerminals();
    const failure = await runFailure(
      terminals,
      actionsOf(action("install", { waitBeforeAgentStart: true })),
      () =>
        terminals.complete("install", {
          type: "failed",
          message: "node-pty process-tree termination failed.",
          outputTail: ["$ bun install", "linking"],
        }),
    );

    expect(failure).toMatchObject({
      _tag: "WorktreeActionTerminalFailedError",
      reason: "node-pty process-tree termination failed.",
      outputTail: ["$ bun install", "linking"],
      message:
        'Worktree action "install" stopped because its terminal failed. node-pty process-tree termination failed.\nLast output:\n$ bun install\nlinking',
    });
  });

  test("fails with the terminal failure as the cause when an action terminal cannot start", async () => {
    const terminals = makeTerminals();
    terminals.failStart("second");
    const failure = await runFailure(
      terminals,
      actionsOf(action("first"), action("second")),
      () => {},
    );

    expect(failure).toMatchObject({
      _tag: "WorktreeActionStartError",
      actionName: "second",
      message: 'Worktree action "second" could not start. The terminal limit has been reached.',
      cause: { _tag: "TerminalServiceError", code: "context_terminal_limit" },
    });
  });

  test("fails without a terminal when an action has only comment lines", async () => {
    const terminals = makeTerminals();
    const failure = await runFailure(
      terminals,
      actionsOf(action("notes", { command: "# install later" })),
      () => {},
    );

    expect(failure).toMatchObject({
      _tag: "WorktreeActionStartError",
      actionName: "notes",
      cause: { _tag: "RepoActionHasNoCommandError", actionName: "notes" },
    });
    expect(startCalls(terminals)).toEqual([]);
  });

  const runPastWaitLimit = (terminals: ReturnType<typeof makeTerminals>) => {
    const run = createWorktreeActionRunner(terminals.terminals).createRun(target);
    const failure = Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flip(
            run.run({
              context,
              actions: actionsOf(action("install", { waitBeforeAgentStart: true })),
            }),
          ),
        );
        yield* TestClock.adjust("4 minutes");
        expect(terminals.calls).not.toContain("tail:terminal-install:20");
        yield* TestClock.adjust("1 minute");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );
    return { run, failure };
  };

  test("fails a waiting action that runs longer than 5 minutes and reports its output tail", async () => {
    const terminals = makeTerminals();
    const { run, failure } = runPastWaitLimit(terminals);

    expect(await failure).toMatchObject({
      _tag: "WorktreeActionTimeoutError",
      outputTail: ["still installing"],
      message:
        'Worktree action "install" did not finish within 5 minutes, so OpenDucktor stopped it.\nLast output:\nstill installing',
    });
    await Effect.runPromise(run.stopTerminals());
    expect(closeCalls(terminals)).toEqual(["close:terminal-install:true"]);
  });

  test("keeps the output tail failure as the cause of a timeout", async () => {
    const terminals = makeTerminals();
    terminals.failOutputTail();
    const { failure } = runPastWaitLimit(terminals);

    expect(await failure).toMatchObject({
      _tag: "WorktreeActionTimeoutError",
      outputTail: [],
      cause: { _tag: "TerminalServiceError", message: "Terminal is gone." },
      message:
        'Worktree action "install" did not finish within 5 minutes, so OpenDucktor stopped it. OpenDucktor could not read its last output: Terminal is gone.',
    });
  });

  test("lets a rollback stop every started terminal when the setup is interrupted", async () => {
    const terminals = makeTerminals();
    const run = createWorktreeActionRunner(terminals.terminals).createRun(target);
    const fiber = Effect.runFork(
      run.run({
        context,
        actions: actionsOf(action("dev"), action("install", { waitBeforeAgentStart: true })),
      }),
    );
    await Bun.sleep(0);
    await Effect.runPromise(Fiber.interrupt(fiber));

    await Effect.runPromise(run.stopTerminals());
    expect(closeCalls(terminals)).toEqual([
      "close:terminal-dev:true",
      "close:terminal-install:true",
    ]);
  });

  test("keeps the worktree when a terminal does not stop, and retries only that terminal", async () => {
    const terminals = makeTerminals();
    terminals.failClose(
      "terminal-install",
      terminalFailure("close_failed", "Failed to terminate terminal terminal-install."),
    );
    // A terminal that exited after its command is already gone and counts as stopped.
    terminals.failClose("terminal-build", terminalFailure("terminal_not_found", "Not found."));
    const run = createWorktreeActionRunner(terminals.terminals).createRun(target);
    await Effect.runPromise(
      run.run({ context, actions: actionsOf(action("dev"), action("install"), action("build")) }),
    );

    const failure = await Effect.runPromise(Effect.flip(run.stopTerminals()));
    expect(failure).toMatchObject({
      _tag: "WorktreeKeptForRunningActionsError",
      worktreePath: "/worktrees/task-1",
      branch: "odt/task-1",
      terminalIds: ["terminal-install"],
      message:
        "Failed to stop worktree action terminals: Failed to terminate terminal terminal-install.\nOpenDucktor kept the worktree at /worktrees/task-1 and the branch odt/task-1, because an action terminal still runs there. Close that terminal or restart OpenDucktor, then remove the worktree and the branch.",
    });
    terminals.failClose("terminal-install", null);
    await Effect.runPromise(run.stopTerminals());
    expect(closeCalls(terminals)).toEqual([
      "close:terminal-build:true",
      "close:terminal-dev:true",
      "close:terminal-install:true",
      "close:terminal-install:true",
    ]);
  });
});
