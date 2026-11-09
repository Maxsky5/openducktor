import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanClaudeTranscriptForGoalRecords } from "./claude-goal-transcript-scan";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const transcript = async (text: string) => {
  const directory = await mkdtemp(join(tmpdir(), "claude-goal-scan-"));
  directories.push(directory);
  const path = join(directory, "session.jsonl");
  await writeFile(path, text);
  return path;
};

const goalLine = '{"type":"attachment","attachment":{"type":"goal_status","met":false}}\n';
const userLine = '{"type":"user","message":{"content":"Hi"}}\n';

describe("scanClaudeTranscriptForGoalRecords", () => {
  test("finds no goal record and ends after the last complete line", async () => {
    const path = await transcript(`${userLine}${userLine}{"type":"user"`);
    expect(await scanClaudeTranscriptForGoalRecords(path, 0)).toEqual({
      hasGoalRecord: false,
      end: userLine.length * 2,
    });
  });

  test("finds a goal record after the start byte only", async () => {
    const path = await transcript(`${goalLine}${userLine}`);
    expect(await scanClaudeTranscriptForGoalRecords(path, 0)).toMatchObject({
      hasGoalRecord: true,
    });
    expect(await scanClaudeTranscriptForGoalRecords(path, goalLine.length)).toEqual({
      hasGoalRecord: false,
      end: goalLine.length + userLine.length,
    });
  });

  test("finds a goal record that spans two read chunks", async () => {
    // The mark crosses the end of the first 1 MiB chunk.
    const filler = `{"type":"user","message":{"content":"${"x".repeat(1024 * 1024 - 89)}"}}\n`;
    const path = await transcript(`${filler}${goalLine}`);
    expect(await scanClaudeTranscriptForGoalRecords(path, 0)).toEqual({
      hasGoalRecord: true,
      end: Buffer.byteLength(filler) + goalLine.length,
    });
  });
});
