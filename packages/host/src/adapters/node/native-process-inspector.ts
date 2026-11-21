import {
  loadProcessNative,
  processNativeFileName,
  type ProcessNativeModule,
} from "@openducktor/process-native";
import { Effect } from "effect";
import {
  HostDependencyError,
  type HostDependencyErrorAggregate,
  type HostOperationErrorAggregate,
  toHostOperationError,
} from "../../effect/host-errors";
import type { ProcessInspectorPort } from "../../ports/process-inspector-port";

export type ProcessNativeLoader = Effect.Effect<ProcessNativeModule, HostDependencyErrorAggregate>;

/**
 * Loads the native process module on first use, so a missing module fails the features that use
 * it with an actionable error instead of the host start.
 */
export const createProcessNativeLoader = (moduleDirectory: string): ProcessNativeLoader => {
  let native: ProcessNativeModule | null = null;
  return Effect.try({
    try: () => {
      native ??= loadProcessNative(moduleDirectory);
      return native;
    },
    catch: (cause) =>
      new HostDependencyError({
        dependency: "process-native",
        operation: "processes.load",
        message: `OpenDucktor cannot load ${processNativeFileName()} from ${moduleDirectory}. Reinstall OpenDucktor, or run \`bun run build\` in a workspace checkout.`,
        cause,
      }),
  });
};

const callNative = <Result>(
  load: ProcessNativeLoader,
  operation: string,
  run: (module: ProcessNativeModule) => Promise<Result>,
): Effect.Effect<Result, HostDependencyErrorAggregate | HostOperationErrorAggregate> =>
  load.pipe(
    Effect.flatMap((module) =>
      Effect.tryPromise({
        try: () => run(module),
        catch: (cause) => toHostOperationError(cause, operation),
      }),
    ),
  );

export const createNativeProcessInspector = (load: ProcessNativeLoader): ProcessInspectorPort => ({
  listProcesses: () => callNative(load, "processes.list", (module) => module.listProcesses()),
  inspectProcesses: (targets) =>
    callNative(load, "processes.inspect", (module) => module.inspectProcesses([...targets])),
  stopMode: () => load.pipe(Effect.map((module) => module.stopMode())),
  stopProcess: (request) =>
    callNative(load, "processes.stop", (module) => module.stopProcess(request)),
  readStandardInputs: (targets) =>
    callNative(load, "processes.readStandardInputs", (module) =>
      module.readStandardInputs([...targets]),
    ),
});

/** Opens a URL with `ShellExecuteExW`, which reports a failure that `explorer.exe` hides. */
export const createWindowsUrlOpener =
  (load: ProcessNativeLoader) =>
  (url: string): Effect.Effect<void, HostDependencyErrorAggregate | HostOperationErrorAggregate> =>
    callNative(load, "openInTools.openExternalUrl", (module) => module.openUrl(url));
