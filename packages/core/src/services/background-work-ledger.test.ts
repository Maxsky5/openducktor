import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_STOP_ROUNDS,
  BackgroundWaiters,
  BackgroundWorkLedger,
  type BackgroundWorkRelease,
  type BackgroundWorkStop,
  stopBackgroundWork,
} from "./background-work-ledger";

type Task = { readonly key: string; readonly sessionID: string; readonly title: string };

// The tree: root > child > grandchild, and root > other.
const PARENTS = new Map([
  ["child", "root"],
  ["grandchild", "child"],
  ["other", "root"],
]);

const createLedger = () =>
  new BackgroundWorkLedger<Task>((rootID) => ({
    has: (sessionID) => {
      for (let id: string | undefined = sessionID; id !== undefined; id = PARENTS.get(id))
        if (id === rootID) return true;
      return false;
    },
  }));

const task = (key: string, sessionID: string): Task => ({ key, sessionID, title: `run ${key}` });

const causes: BackgroundWorkRelease<Task> = {
  dropped: (sessionID) => new Error(`${sessionID} was released.`),
  unresolved: (tasks, results) =>
    new Error(`Left ${tasks.map(({ title }) => title).join(", ")} and ${results} results.`),
};

const failureOf = (promise: Promise<void>): Promise<Error | undefined> =>
  promise.then(
    () => undefined,
    (cause: Error) => cause,
  );

describe("BackgroundWorkLedger", () => {
  test("lists the tasks and results of a session tree, oldest first", () => {
    const ledger = createLedger();
    ledger.start(task("a", "grandchild"));
    ledger.start(task("b", "root"));
    ledger.start(task("c", "other"));
    ledger.addResult("inbox-1", "child");

    expect(ledger.tasksIn("root").map(({ key }) => key)).toEqual(["a", "b", "c"]);
    expect(ledger.tasksIn("child").map(({ key }) => key)).toEqual(["a"]);
    expect(ledger.tasksOf("root").map(({ key }) => key)).toEqual(["b"]);
    expect(ledger.resultsIn("root")).toEqual([{ key: "inbox-1", sessionID: "child" }]);
    expect(ledger.resultsIn("other")).toEqual([]);
    expect(ledger.hasWork("other")).toBe(true);
    expect(ledger.end("c")?.key).toBe("c");
    expect(ledger.hasWork("other")).toBe(false);
  });

  test("counts an undelivered result as work until it settles", async () => {
    const ledger = createLedger();
    ledger.addResult("inbox-1", "child");
    expect(ledger.resultOwner("inbox-1")).toBe("child");
    expect(ledger.hasWork("root")).toBe(true);
    const settled = ledger.waitForSettle("inbox-1");

    expect(ledger.settleResult("inbox-1")).toBe(true);
    await settled;
    expect(ledger.hasWork("root")).toBe(false);
    expect(ledger.settleResult("inbox-1")).toBe(false);
    await ledger.waitForSettle("inbox-1");
  });

  test("resolves a wait only on the end event of the task run", async () => {
    const ledger = createLedger();
    const first = task("job", "root");
    ledger.start(first);
    const ending = ledger.waitForEnd(first);
    ledger.end("job");
    await ending;
    // A new run under the same key does not end the earlier run again.
    ledger.start(task("job", "root"));
    await ledger.waitForEnd(first);
    expect(ledger.ended(first)).toBe(true);
  });

  test("fails the waits of a session that lost its tracking, also later ones", async () => {
    const ledger = createLedger();
    const running = task("a", "child");
    ledger.start(running);
    ledger.addResult("inbox-1", "child");
    const ending = failureOf(ledger.waitForEnd(running));
    const settling = failureOf(ledger.waitForSettle("inbox-1"));
    const lost = new Error("An item was unreadable.");

    ledger.lose("child", lost);

    expect(await ending).toBe(lost);
    expect(await settling).toBe(lost);
    expect(await failureOf(ledger.waitForEnd(running))).toBe(lost);
    expect(ledger.tasksIn("root")).toEqual([running]);
    expect(ledger.lossOf("child")).toBe(lost);
    expect(ledger.lostIn("root")).toBe(lost);
    expect(ledger.lostIn("other")).toBeUndefined();
  });

  test("fails the waits of a removed session, and confirms no end of its tasks", async () => {
    const ledger = createLedger();
    const running = task("a", "child");
    ledger.start(running);
    ledger.addResult("inbox-1", "child");
    const ending = failureOf(ledger.waitForEnd(running));
    const removed = new Error("child was removed.");

    expect(ledger.removeSession("child", removed)).toBe(true);

    expect(await ending).toBe(removed);
    expect(await failureOf(ledger.waitForEnd(running))).toBe(removed);
    expect(await failureOf(ledger.waitForSettle("inbox-1"))).toBe(removed);
    expect(ledger.ended(running)).toBe(false);
    ledger.lose("child", new Error("Lost."));
    expect(ledger.removeSession("child", removed)).toBe(false);
    expect(ledger.lostIn("root")).toBeUndefined();
  });

  test("fails every wait at the close, and each later wait at once", async () => {
    const ledger = createLedger();
    const running = task("a", "root");
    ledger.start(running);
    ledger.addResult("inbox-1", "root");
    const ending = failureOf(ledger.waitForEnd(running));
    const closed = new Error("The runtime ended.");

    ledger.close(closed);
    ledger.close(new Error("A later close."));

    expect(await ending).toBe(closed);
    expect(ledger.closed).toBe(closed);
    expect(await failureOf(ledger.waitForEnd(running))).toBe(closed);
    expect(await failureOf(ledger.waitForSettle("inbox-1"))).toBe(closed);
    ledger.end("a");
    expect(await failureOf(ledger.waitForEnd(running))).toBe(closed);
  });

  test("ends a synchronous watch when its function is called", () => {
    const ledger = createLedger();
    const running = task("a", "root");
    ledger.start(running);
    const calls: string[] = [];
    const unwatch = ledger.watchEnd(running, {
      resolve: () => calls.push("ended"),
      reject: () => calls.push("failed"),
    });
    unwatch();
    ledger.end("a");
    expect(calls).toEqual([]);
    ledger.watchEnd(running, {
      resolve: () => calls.push("ended"),
      reject: () => calls.push("failed"),
    });
    expect(calls).toEqual(["ended"]);
  });

  test("moves the unresolved work of released sessions as a loss to the observed ancestor", () => {
    const ledger = createLedger();
    ledger.start(task("a", "grandchild"));
    ledger.addResult("inbox-1", "child");
    const earlier = new Error("Root lost an item.");
    ledger.lose("root", earlier);
    const held = new Error("Child held a loss.");
    ledger.lose("child", held);

    const cause = ledger.release(["child", "grandchild"], "root", causes);

    expect(cause?.message).toBe("Root lost an item. Left run a and 1 results. Child held a loss.");
    expect(ledger.lossOf("root")).toBe(cause);
    expect(ledger.tasksIn("root")).toEqual([]);
    expect(ledger.resultsIn("root")).toEqual([]);
    expect(ledger.lossOf("child")).toBeUndefined();
  });

  test("keeps one reason as the same error, and removes duplicate reasons", () => {
    const ledger = createLedger();
    const held = new Error("Grandchild work is unknown.");
    ledger.lose("child", held);
    expect(ledger.release(["child"], "root", causes)).toBe(held);
    ledger.lose("other", new Error("Grandchild work is unknown."));
    expect(ledger.release(["other"], "root", causes)).toBe(held);
    expect(ledger.release(["grandchild"], "root", causes)).toBeUndefined();
  });

  test("drops the work and losses of a root release, and keeps the waits of the ancestor", async () => {
    const ledger = createLedger();
    const rootTask = task("a", "root");
    ledger.start(rootTask);
    ledger.start(task("b", "child"));
    let ancestorWait = "pending";
    void ledger.waitForEnd(rootTask).then(
      () => (ancestorWait = "ended"),
      () => (ancestorWait = "failed"),
    );

    expect(ledger.release(["child"], "root", causes)?.message).toBe("Left run b and 0 results.");
    await Promise.resolve();
    expect(ancestorWait).toBe("pending");
    expect(ledger.release(["root"], undefined, causes)).toBeUndefined();
    await Promise.resolve();
    expect(ancestorWait).toBe("failed");
    expect(ledger.lostIn("root")).toBeUndefined();
  });

  test("ignores a failed stop request only when the end of the task is confirmed", async () => {
    const ledger = createLedger();
    const ending = task("a", "root");
    const dropped = task("b", "child");
    ledger.start(ending);
    ledger.start(dropped);
    const failed = new Error("The stop request failed.");

    await ledger.stopTask(ending, async () => {
      ledger.end("a");
      throw failed;
    });
    const failure = await failureOf(
      ledger.stopTask(dropped, async () => {
        ledger.removeSession("child", new Error("Released."));
        throw failed;
      }),
    );

    expect(failure).toBe(failed);
  });
});

describe("BackgroundWaiters", () => {
  test("resolves, fails, and removes the waits of one key", async () => {
    const waiters = new BackgroundWaiters();
    const resolved = waiters.wait("a");
    const failed = failureOf(waiters.wait("b"));
    const calls: string[] = [];
    const removed = waiters.add("a", {
      resolve: () => calls.push("resolved"),
      reject: () => calls.push("failed"),
    });
    removed();
    waiters.resolve("a");
    const cause = new Error("Closed.");
    waiters.rejectAll(cause);
    await resolved;
    expect(await failed).toBe(cause);
    expect(calls).toEqual([]);
  });
});

describe("stopBackgroundWork", () => {
  const stopSteps = (
    ledger: BackgroundWorkLedger<Task>,
    log: string[],
    overrides: Partial<BackgroundWorkStop<Task>> = {},
  ): BackgroundWorkStop<Task> => ({
    inEventOrder: async (read) => {
      log.push("read");
      return read();
    },
    stop: (tasks) => {
      log.push(`watch ${tasks.map(({ key }) => key).join(" ")}`);
      return async () => {
        for (const { key } of tasks) ledger.end(key);
      };
    },
    tooMany: (tasks) => new Error(`Still runs: ${tasks.map(({ title }) => title).join(", ")}.`),
    idle: () => log.push("idle"),
    ...overrides,
  });

  test("succeeds at once without work in the tree", async () => {
    const ledger = createLedger();
    ledger.start(task("a", "other"));
    const log: string[] = [];
    await stopBackgroundWork(ledger, "child", stopSteps(ledger, log));
    expect(log).toEqual(["read", "idle"]);
  });

  test("stops the tasks of each round and checks the tree again", async () => {
    const ledger = createLedger();
    ledger.start(task("a", "root"));
    const log: string[] = [];
    await stopBackgroundWork(
      ledger,
      "root",
      stopSteps(ledger, log, {
        stop: (tasks) => {
          log.push(`watch ${tasks.map(({ key }) => key).join(" ")}`);
          return async () => {
            for (const { key } of tasks) ledger.end(key);
            // A child starts a task during the wait.
            if (tasks[0]?.key === "a") ledger.start(task("b", "child"));
          };
        },
      }),
    );
    expect(log).toEqual(["read", "watch a", "read", "watch b", "read", "idle"]);
  });

  test("fails after the last round and keeps the tasks that still run", async () => {
    const ledger = createLedger();
    let next = 0;
    ledger.start(task(`t${next}`, "root"));
    const log: string[] = [];
    const failure = await failureOf(
      stopBackgroundWork(
        ledger,
        "root",
        stopSteps(ledger, log, {
          stop: (tasks) => async () => {
            for (const { key } of tasks) ledger.end(key);
            next += 1;
            ledger.start(task(`t${next}`, "child"));
          },
        }),
      ),
    );
    expect(String(failure)).toBe(`Error: Still runs: run t${BACKGROUND_STOP_ROUNDS}.`);
    expect(ledger.tasksIn("root").map(({ key }) => key)).toEqual([`t${BACKGROUND_STOP_ROUNDS}`]);
    expect(log).not.toContain("idle");
  });

  test("settles the undelivered results without a round, then checks the tree again", async () => {
    const ledger = createLedger();
    ledger.addResult("inbox-1", "child");
    const log: string[] = [];
    await stopBackgroundWork(
      ledger,
      "root",
      stopSteps(ledger, log, {
        settle: async (results) => {
          log.push(`settle ${results.map(({ key }) => key).join(" ")}`);
          for (const { key } of results) ledger.settleResult(key);
        },
      }),
    );
    expect(log).toEqual(["read", "settle inbox-1", "read", "idle"]);
  });

  test("fails before any stop request when the tree lost its tracking", async () => {
    const ledger = createLedger();
    // A task still runs, but the tree cannot confirm the end of its work.
    ledger.start(task("a", "child"));
    ledger.lose("grandchild", new Error("An item was unreadable."));
    const log: string[] = [];
    const failure = await failureOf(
      stopBackgroundWork(
        ledger,
        "root",
        stopSteps(ledger, log, { lost: (lost) => new Error(`Stop failed: ${lost.message}`) }),
      ),
    );
    expect(String(failure)).toBe("Error: Stop failed: An item was unreadable.");
    expect(log).toEqual(["read"]);
  });

  test("fails with the failure of a stop round", async () => {
    const ledger = createLedger();
    ledger.start(task("a", "root"));
    const failed = new Error("The end was not confirmed.");
    const failure = await failureOf(
      stopBackgroundWork(
        ledger,
        "root",
        stopSteps(ledger, [], {
          stop: () => async () => {
            throw failed;
          },
        }),
      ),
    );
    expect(failure).toBe(failed);
    expect(ledger.tasksIn("root")).toHaveLength(1);
  });
});
