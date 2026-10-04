import { Effect } from "effect";
import type { HostRuntimeService } from "../application/runtimes/host-runtime-service";

const unexpectedCall = (method: string) => () =>
  Effect.dieMessage(`Unexpected host runtime service call: ${method}`);

export const createHostRuntimeServiceTestDouble = (
  overrides: Partial<HostRuntimeService> = {},
): HostRuntimeService => ({
  initialize: unexpectedCall("initialize"),
  snapshot: unexpectedCall("snapshot"),
  requireRuntime: unexpectedCall("requireRuntime"),
  restartImpact: unexpectedCall("restartImpact"),
  restart: unexpectedCall("restart"),
  previewSettings: unexpectedCall("previewSettings"),
  saveSettings: unexpectedCall("saveSettings"),
  ...overrides,
});
