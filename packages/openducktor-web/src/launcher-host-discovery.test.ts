import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DiscoveryScenarioResult } from "./launcher-host-discovery-fixture";

const fixturePath = path.join(import.meta.dir, "launcher-host-discovery-fixture.ts");

describe("web launcher MCP discovery composition", () => {
  for (const scenario of [
    {
      ambientChannel: "production",
      launchMode: "workspace",
      oppositeDescriptor: '{"hostUrl":"http://127.0.0.1:1","hostToken":"prod","pid":1}\n',
      title: "workspace launches own only development discovery",
    },
    {
      ambientChannel: "dev",
      launchMode: "installed",
      oppositeDescriptor: '{"hostUrl":"http://127.0.0.1:2","hostToken":"dev","pid":2}\n',
      title: "installed launches own only production discovery",
    },
  ] as const) {
    test(scenario.title, async () => {
      const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-web-discovery-"));

      try {
        const subprocess = Bun.spawn(
          [process.execPath, fixturePath, scenario.launchMode, scenario.oppositeDescriptor],
          {
            env: {
              ...process.env,
              OPENDUCKTOR_CHANNEL: scenario.ambientChannel,
              OPENDUCKTOR_CONFIG_DIR: configDirectory,
            },
            stderr: "pipe",
            stdout: "pipe",
          },
        );
        const [exitCode, stdout, stderr] = await Promise.all([
          subprocess.exited,
          Bun.readableStreamToText(subprocess.stdout),
          Bun.readableStreamToText(subprocess.stderr),
        ]);

        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        const result = JSON.parse(stdout) as DiscoveryScenarioResult;
        expect(result).toEqual({
          descriptor: {
            hostTokenPresent: true,
            hostUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
            pidMatchesProcess: true,
          },
          oppositeAfterStop: scenario.oppositeDescriptor,
          oppositeDuringRun: scenario.oppositeDescriptor,
          selectedMissingAfterStop: true,
        });
      } finally {
        await rm(configDirectory, { force: true, recursive: true });
      }
    }, 10_000);
  }
});
