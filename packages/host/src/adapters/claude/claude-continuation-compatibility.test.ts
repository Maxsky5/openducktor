import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_INTERRUPTED_TURN_RESUME_VERIFIED_VERSION } from "./claude-continuation-compatibility";
import { createClaudeHistoryInputProjector } from "./claude-agent-sdk-history-input";
import { isClaudeMetaStreamMessage } from "./claude-agent-sdk-local-commands";
import {
  CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV,
  buildClaudeAgentSdkBaseOptions,
} from "./claude-agent-sdk-options";

/**
 * The Claude continuation contract depends on the bundled CLI classifier. The host runs
 * the CLI from runtime settings, so the version below pins the artifact this contract was
 * verified against. A version bump fails this test and forces a re-check of the classifier.
 */
const SUPPORTED_CLAUDE_CLI_VERSION = CLAUDE_INTERRUPTED_TURN_RESUME_VERIFIED_VERSION;

type ClaudeSdkManifestEntry = {
  binary: string;
  checksum: string;
  size: number;
};

type ClaudeSdkManifest = {
  version: string;
  platforms: Record<string, ClaudeSdkManifestEntry>;
};

const claudeSdkDirectory = (): string =>
  dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk")));

const readClaudeSdkManifest = (): ClaudeSdkManifest => {
  // SAFETY: The installed SDK package ships manifest.json with this shape.
  return JSON.parse(
    readFileSync(join(claudeSdkDirectory(), "manifest.json"), "utf8"),
  ) as ClaudeSdkManifest;
};

const currentPlatformKey = (): string => `${process.platform}-${process.arch}`;

const resolveBundledCli = (manifest: ClaudeSdkManifest) => {
  const platform = currentPlatformKey();
  for (const platformKey of Object.keys(manifest.platforms)) {
    if (!platformKey.startsWith(platform)) {
      continue;
    }
    const entry = manifest.platforms[platformKey];
    if (!entry) {
      continue;
    }
    const binaryPath = join(
      claudeSdkDirectory(),
      "..",
      `claude-agent-sdk-${platformKey}`,
      entry.binary,
    );
    if (existsSync(binaryPath)) {
      return { platformKey, entry, binaryPath };
    }
  }
  throw new Error(
    `The installed @anthropic-ai/claude-agent-sdk does not ship a CLI for platform ` +
      `'${platform}'. Install the matching optional dependency and rerun this test.`,
  );
};

const sha256OfFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });

const readBundledCliVersion = (binaryPath: string): string => {
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`The Claude CLI exited with code ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout.trim();
};

const findMissingSequencesInFile = async (
  path: string,
  sequences: readonly { label: string; bytes: Buffer }[],
): Promise<string[]> => {
  const overlap = Math.max(...sequences.map((sequence) => sequence.bytes.length)) - 1;
  const missing = new Map(sequences.map((sequence) => [sequence.label, sequence.bytes]));
  let pending = Buffer.alloc(0);
  // SAFETY: A read stream without an encoding yields Buffer chunks.
  const chunks = createReadStream(path, {
    highWaterMark: 1024 * 1024,
  }) as AsyncIterable<Buffer>;
  for await (const chunk of chunks) {
    const buffer = Buffer.concat([pending, chunk]);
    for (const [label, bytes] of missing) {
      if (buffer.includes(bytes)) {
        missing.delete(label);
      }
    }
    if (missing.size === 0) {
      break;
    }
    pending = buffer.subarray(Math.max(0, buffer.length - overlap));
  }
  return [...missing.keys()];
};

const readInstalledSdkSource = (fileName: string): string =>
  readFileSync(join(claudeSdkDirectory(), fileName), "utf8");

describe("Claude interrupted-turn resume compatibility", () => {
  test("pins the Claude CLI version this continuation contract was verified against", () => {
    const manifest = readClaudeSdkManifest();

    expect(
      manifest.version,
      `The installed @anthropic-ai/claude-agent-sdk ships CLI version ${manifest.version}, but ` +
        `the interrupted-turn resume contract was verified against ` +
        `${SUPPORTED_CLAUDE_CLI_VERSION}. Verify the CLI classifier that reads ` +
        `${CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV}, update ` +
        `CLAUDE_INTERRUPTED_TURN_RESUME_VERIFIED_VERSION, and adjust ` +
        `packages/host/src/adapters/claude when the behavior changed.`,
    ).toBe(SUPPORTED_CLAUDE_CLI_VERSION);
  });

  test("ships the verified CLI build for this platform", async () => {
    const manifest = readClaudeSdkManifest();
    const { entry, binaryPath } = resolveBundledCli(manifest);

    expect(statSync(binaryPath).size).toBe(entry.size);
    expect(await sha256OfFile(binaryPath)).toBe(entry.checksum);
    expect(readBundledCliVersion(binaryPath)).toContain(SUPPORTED_CLAUDE_CLI_VERSION);
  });

  test("keeps the resume switch and the hidden continuation turn in the shipped CLI", async () => {
    const manifest = readClaudeSdkManifest();
    const { binaryPath } = resolveBundledCli(manifest);

    const missing = await findMissingSequencesInFile(binaryPath, [
      {
        label: CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV,
        bytes: Buffer.from(CLAUDE_CODE_RESUME_INTERRUPTED_TURN_ENV),
      },
      {
        label: "Continue from where you left off.",
        bytes: Buffer.from("Continue from where you left off."),
      },
    ]);

    expect(
      missing,
      `The bundled Claude CLI no longer carries ${missing.join(", ")}. It cannot classify an ` +
        `interrupted transcript or hide its continuation turn, so disable ` +
        `claudeInterruptedTurnResumeEnabled until the CLI contract is verified again.`,
    ).toEqual([]);
  });

  test("mentions the resume switch in the installed SDK bundle", () => {
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
