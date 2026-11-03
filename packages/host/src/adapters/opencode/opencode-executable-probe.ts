import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import type { RuntimeExecutableProbePort } from "../../ports/runtime-executable-probe-port";
import { useRuntimeProbeResource } from "../runtimes/runtime-executable-probe-lifecycle";
import {
  acquireOpenCodeStandalone,
  type OpenCodeStandaloneOptions,
} from "./opencode-standalone-process";

export type CreateOpenCodeExecutableProbeInput = OpenCodeStandaloneOptions;
export const createOpenCodeExecutableProbe = (
  options: CreateOpenCodeExecutableProbeInput = {},
): RuntimeExecutableProbePort => ({
  probeExecutable(executablePath) {
    return useRuntimeProbeResource({
      acquire: acquireOpenCodeStandalone({
        ...options,
        executablePath,
        workingDirectory: process.cwd(),
        runtimeId: randomUUID(),
      }),
      probe: (owned) => owned.waitReady.pipe(Effect.asVoid),
      release: (owned) => owned.stop,
      cleanupOperation: "opencodeExecutableProbe.cleanup",
    });
  },
});
