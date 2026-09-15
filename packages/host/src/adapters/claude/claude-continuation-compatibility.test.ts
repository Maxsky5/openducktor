import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV,
  buildClaudeAgentSdkBaseOptions,
} from "./claude-agent-sdk-options";
import { createClaudeHistoryInputProjector } from "./claude-agent-sdk-history-input";
import { isClaudeMetaStreamMessage } from "./claude-agent-sdk-local-commands";

const readInstalledSdkSource = (fileName: string): string => {
  const entryUrl = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
  return readFileSync(join(dirname(fileURLToPath(entryUrl)), fileName), "utf8");
};

describe("Claude interrupted-turn resume compatibility", () => {
  test("the installed SDK bundle still honors CLAUDE_CODE_RESUME_INTERRUPTED_TURN", () => {
    const missing: string[] = [];
    for (const fileName of ["sdk.mjs", "bridge.mjs"]) {
      if (!readInstalledSdkSource(fileName).includes(CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV)) {
        missing.push(fileName);
      }
    }

    expect(
      missing,
      `The installed @anthropic-ai/claude-agent-sdk no longer mentions ` +
        `${CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV} in ${missing.join(", ")}. ` +
        `Verify the Claude continuation mechanism against the installed CLI. ` +
        `Then change packages/host/src/adapters/claude or disable ` +
        `claudeInterruptedTurnResumeEnabled.`,
    ).toEqual([]);
  });

  test("the adapter writes the SDK switch value the bundle consumes", () => {
    expect(CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV).toBe("CLAUDE_CODE_RESUME_INTERRUPTED_TURN");

    const options = buildClaudeAgentSdkBaseOptions({
      claudeExecutablePath: process.execPath,
      cwd: process.cwd(),
      resumeInterruptedTurn: true,
    });
    expect(options.env?.[CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV]).toBe("1");
  });

  test("the hidden continuation user turn stays out of imported history", () => {
    const project = createClaudeHistoryInputProjector({ liveUserMessages: [] });
    const metaTurn = project(
      {
        type: "user",
        uuid: "meta-continuation-turn",
        session_id: "session-1",
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: {
          role: "user",
          content: [{ type: "text", text: "Continue from where you left off." }],
        },
        isMeta: true,
      },
      "2026-09-15T10:00:00.000Z",
    );

    expect(metaTurn).toEqual({ handled: true });
    expect(metaTurn).not.toHaveProperty("message");

    const humanTurn = project(
      {
        type: "user",
        uuid: "human-turn",
        session_id: "session-1",
        parent_tool_use_id: null,
        parent_agent_id: null,
        message: {
          role: "user",
          content: [{ type: "text", text: "Add the resume action." }],
        },
      },
      "2026-09-15T10:00:01.000Z",
    );
    expect(humanTurn).toMatchObject({
      handled: true,
      message: { role: "user", text: "Add the resume action." },
    });
  });

  test("the live stream drops messages the CLI marks as meta", () => {
    expect(isClaudeMetaStreamMessage({ type: "user", isMeta: true })).toBe(true);
    expect(isClaudeMetaStreamMessage({ type: "user" })).toBe(false);
  });
});
