import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isClaudeContinuationAdmission } from "./claude-agent-sdk-continuation-admission";
import { buildClaudeAgentSdkBaseOptions } from "./claude-agent-sdk-options";
import { AsyncInputQueue } from "./claude-agent-sdk-queue";

await run();

/** Check native admission with a temporary config and test credentials. */
async function run(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openducktor-claude-resume-"));
  const cwd = join(root, "repo");
  const config = join(root, "config");
  const transcripts = join(config, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  const sessionId = randomUUID();
  const queue = new AsyncInputQueue<SDKUserMessage>();
  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(transcripts, { recursive: true });
    await writeFile(join(transcripts, `${sessionId}.jsonl`), transcript(cwd, sessionId));
    const options = buildClaudeAgentSdkBaseOptions({
      claudeExecutablePath: process.execPath,
      cwd,
      resumeInterruptedTurn: true,
      processEnv: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SystemRoot: process.env.SystemRoot,
        CLAUDE_CONFIG_DIR: config,
        ANTHROPIC_API_KEY: "resume-test-placeholder",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    });
    // Use the pinned CLI so this check does not need a user's Claude installation.
    delete options.pathToClaudeCodeExecutable;
    const stream = query({
      prompt: queue,
      options: { ...options, resume: sessionId, settingSources: [], tools: [] },
    });
    const timeout = setTimeout(() => {
      queue.close();
      stream.close();
    }, 7500);
    try {
      for await (const message of stream) {
        if (isClaudeContinuationAdmission(message)) {
          console.log("Continuation admitted without a new user message.");
          return;
        }
      }
      throw new Error("Claude did not admit the interrupted turn after an old API error.");
    } finally {
      clearTimeout(timeout);
      queue.close();
      stream.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function transcript(cwd: string, sessionId: string): string {
  const timestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const user = {
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    type: "user",
    message: { role: "user", content: "Reply with hello." },
    uuid: randomUUID(),
    timestamp,
  };
  const apiError = {
    ...user,
    parentUuid: user.uuid,
    uuid: randomUUID(),
    type: "assistant",
    isApiErrorMessage: true,
    error: "rate_limit",
    message: {
      id: "resume-test-api-error",
      type: "message",
      role: "assistant",
      model: "<synthetic>",
      content: [{ type: "text", text: "Session limit reached" }],
      stop_reason: "stop_sequence",
      stop_sequence: "",
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  };
  return `${[user, apiError].map((row) => JSON.stringify(row)).join("\n")}\n`;
}
