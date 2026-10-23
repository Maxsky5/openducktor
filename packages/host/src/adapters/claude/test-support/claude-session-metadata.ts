import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as sdk from "@anthropic-ai/claude-agent-sdk";
import { spyOn } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import { claudeSessionMetadataAdapter } from "../claude-session-metadata-adapter";

const config = await realpath(process.env.CLAUDE_CONFIG_DIR!);
const read = (id: string) =>
  Effect.runPromise(claudeSessionMetadataAdapter.readWorkingDirectory(id));
const query = spyOn(sdk, "query").mockImplementation(() => {
  throw new Error("Metadata must not start a Claude runtime.");
});
const messages = spyOn(sdk, "getSessionMessages").mockImplementation(() => {
  throw new Error("Metadata must not load a full transcript.");
});
try {
  if (process.argv[2] === "prepare-fork") {
    const repo = join(config, "repo");
    const origin = join(config, "origin");
    const destination = join(config, "destination");
    await mkdir(repo);
    const gitExecutable = Bun.which("git")!;
    const git = (...args: string[]) => execFileSync(gitExecutable, args, { stdio: "ignore" });
    git("init", repo);
    git(
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    );
    git("-C", repo, "worktree", "add", "-b", "origin", origin);
    git("-C", repo, "worktree", "add", "-b", "destination", destination);
    const project = join(config, "projects", origin.replace(/[^a-zA-Z0-9]/g, "-"));
    await mkdir(project, { recursive: true });
    const sourceId = randomUUID();
    const userId = randomUUID();
    const replyId = randomUUID();
    const base = {
      cwd: origin,
      sessionId: sourceId,
      timestamp: "2026-10-22T10:00:00.000Z",
      isSidechain: false,
    };
    await writeFile(
      join(project, `${sourceId}.jsonl`),
      [
        {
          ...base,
          type: "user",
          uuid: userId,
          parentUuid: null,
          message: { role: "user", content: "Inspect the source worktree" },
        },
        {
          ...base,
          type: "assistant",
          uuid: replyId,
          parentUuid: userId,
          message: {
            id: "reply",
            role: "assistant",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Source inspected" }],
          },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );
    const fork = await sdk.forkSession(sourceId, { dir: origin, upToMessageId: replyId });
    assert.notEqual(fork.sessionId, sourceId);
    assert.equal(await read(fork.sessionId), origin);
    git("-C", repo, "worktree", "remove", "--force", destination);
    git("-C", repo, "worktree", "remove", "--force", origin);
    process.stdout.write(
      JSON.stringify({ externalSessionId: fork.sessionId, workingDirectory: origin }),
    );
  } else if (process.argv[2] === "read") {
    process.stdout.write(JSON.stringify(await read(process.argv[3]!)));
  } else if (process.argv[2] === "failures") {
    const project = join(config, "projects", "metadata-fixture");
    await mkdir(project, { recursive: true });
    const assertFailure = async (id: string, reason: RegExp) => {
      await assert.rejects(read(id), (error: Error) => {
        assert.ok(error instanceof HostOperationError);
        assert.equal(error.operation, "claude.session.metadata.readWorkingDirectory");
        assert.ok(error.message.includes(id));
        assert.match(error.message, reason);
        assert.match(error.message, /then retry|Turn off worktree removal to archive the chat\./);
        return true;
      });
    };
    await assertFailure(randomUUID(), /missing or unreadable/);
    await assertFailure("not-a-session-uuid", /missing or unreadable/);
    for (const cwd of [undefined, "", "relative/worktree"]) {
      const id = randomUUID();
      await writeFile(
        join(project, `${id}.jsonl`),
        JSON.stringify({ customTitle: "Saved session", cwd }) + "\n",
      );
      await assertFailure(id, /no absolute working directory/);
    }
    const id = randomUUID();
    const metadata = spyOn(sdk, "getSessionInfo").mockResolvedValue({
      sessionId: randomUUID(),
      cwd: config,
      summary: "Wrong session",
      lastModified: 0,
    });
    try {
      await assertFailure(id, /metadata for another session/);
      metadata.mockRejectedValue(new Error("Native access denied"));
      await assertFailure(id, /Native access denied/);
    } finally {
      metadata.mockRestore();
    }
    process.stdout.write("Claude metadata failures verified.\n");
  } else {
    throw new Error("Unknown metadata fixture action.");
  }
  assert.equal(query.mock.calls.length, 0);
  assert.equal(messages.mock.calls.length, 0);
} finally {
  query.mockRestore();
  messages.mockRestore();
}
