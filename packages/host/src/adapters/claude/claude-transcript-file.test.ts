import { afterEach, expect, test } from "bun:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import { scanClaudeTranscriptBatches } from "./claude-transcript-file";

const directories: string[] = [];
const padding = `${JSON.stringify({ type: "file-history-snapshot", snapshot: "A".repeat(1024 * 1024) })}\n`;
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const transcript = async (head: string, tail = "") => {
  const directory = await mkdtemp(join(tmpdir(), "claude-parallel-scan-"));
  directories.push(directory);
  const path = join(directory, "history.jsonl");
  const file = await open(path, "w");
  try {
    await file.write(head);
    for (let index = 0; index < 33; index++) await file.write(padding);
    await file.write(tail);
  } finally {
    await file.close();
  }
  return path;
};

const collect = async (path: string) => {
  const records: ClaudeProtocolObject[] = [];
  await Effect.runPromise(
    scanClaudeTranscriptBatches(path, (batch) =>
      Effect.sync(() => {
        records.push(...batch);
      }),
    ),
  );
  return records;
};

test("large scans preserve worker order across oversized and unterminated serial records", async () => {
  const content = "新しい内容😀\n".repeat(10_000);
  const oversized = {
    type: "user",
    uuid: "oversized",
    snapshots: "A".repeat(3 * 1024 * 1024),
    toolUseResult: { structuredContent: { content, type: "create" } },
  };
  const following = { type: "assistant", uuid: "following", message: { content: "Après 😀" } };
  const final = { type: "assistant", uuid: "final", message: { content: "最後" } };
  const path = await transcript(
    `${JSON.stringify({ type: "user", uuid: "first" })}\n`,
    `${JSON.stringify(oversized)}\n${JSON.stringify(following)}\n${JSON.stringify(final)}`,
  );
  const snapshots: string[][] = [];
  const records: ClaudeProtocolObject[] = [];
  await Effect.runPromise(
    scanClaudeTranscriptBatches(
      path,
      (batch) =>
        Effect.sync(() => {
          records.push(...batch);
        }),
      {
        onReadSnapshot: (before, after) => {
          snapshots.push([before, after]);
        },
      },
    ),
  );
  expect(records).toEqual([
    { type: "user", uuid: "first" },
    {
      type: "user",
      uuid: "oversized",
      toolUseResult: { structuredContent: { content, type: "create" } },
    },
    following,
    final,
  ]);
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]![0]).toBe(snapshots[0]![1]);
});

test("large scans ignore an incomplete final line after ordered worker records", async () => {
  const path = await transcript(
    `${JSON.stringify({ type: "user", uuid: "first" })}\n`,
    `${JSON.stringify({ type: "assistant", uuid: "last-complete" })}\n{"type":"assistant","message":`,
  );
  expect(await collect(path)).toEqual([
    { type: "user", uuid: "first" },
    { type: "assistant", uuid: "last-complete" },
  ]);
});

test("a later worker parse failure reports its physical source line", async () => {
  const path = await transcript(`${padding}${padding}{"type":"assistant","message":}\n`);
  const failure = await Effect.runPromise(
    Effect.result(scanClaudeTranscriptBatches(path, () => Effect.void)),
  );
  expect(failure._tag).toBe("Failure");
  if (failure._tag !== "Failure") throw new Error("Expected a malformed source failure");
  expect(failure.failure.message).toContain(`${path}:3`);
  expect(failure.failure.cause).toBeInstanceOf(Error);
});

test("disposing a large scan owner waits for all workers before closing its source file", async () => {
  const path = await transcript(`${JSON.stringify({ type: "user", uuid: "first" })}\n`);
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      String.raw`
      import assert from "node:assert/strict";
      import {open} from "node:fs/promises";
      import {Worker} from "node:worker_threads";
      import {Deferred,Effect,Fiber} from "effect";
      const {scanClaudeTranscriptBatches}=await import(process.env.ODT_SCAN_MODULE);
      const {createClaudeTranscriptReadOwner}=await import(process.env.ODT_OWNER_MODULE);
      const path=process.env.ODT_SCAN_PATH;
      const probe=await open(path,"r");
      const prototype=Object.getPrototypeOf(probe);
      await probe.close();
      const entered=Deferred.makeUnsafe();
      let terminated=0;
      const closeCounts=[];
      let closed=false;
      const terminate=Worker.prototype.terminate;
      Worker.prototype.terminate=function(){return terminate.call(this).then(code=>{terminated++;return code;});};
      const close=prototype.close;
      prototype.close=function(){closeCounts.push(terminated);return close.call(this).then(()=>{closed=true;});};
      const owner=createClaudeTranscriptReadOwner({
        read:()=>scanClaudeTranscriptBatches(path,()=>Deferred.succeed(entered,undefined).pipe(Effect.andThen(Effect.never))).pipe(
          Effect.as({messages:[],source:{root:path,selected:path,sessionId:"session"}})
        )
      });
      const fiber=Effect.runFork(owner.read({repoPath:"/repo",workingDirectory:"/repo",externalSessionId:"session",runtimeKind:"claude",runtimePolicy:{kind:"claude"}}));
      try{
        await Effect.runPromise(Deferred.await(entered));
        await Effect.runPromise(owner.dispose());
        assert.equal(terminated,4);
        assert.deepEqual(closeCounts,[4]);
        assert.equal(closed,true);
      }finally{
        await Effect.runPromise(Fiber.interrupt(fiber));
        prototype.close=close;
        Worker.prototype.terminate=terminate;
      }
    `,
    ],
    {
      cwd: import.meta.dir,
      env: {
        ...process.env,
        ODT_SCAN_PATH: path,
        ODT_SCAN_MODULE: new URL("./claude-transcript-file.ts", import.meta.url).href,
        ODT_OWNER_MODULE: new URL("./claude-transcript-read-owner.ts", import.meta.url).href,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 8_000,
      killSignal: "SIGKILL",
    },
  );
  try {
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ output, error, code }).toEqual({ output: "", error: "", code: 0 });
  } finally {
    child.kill();
    await child.exited;
  }
}, 10_000);
