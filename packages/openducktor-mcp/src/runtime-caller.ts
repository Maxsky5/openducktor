import type { RequestMeta } from "@modelcontextprotocol/sdk/types.js";
import {
  knownRuntimeKindSchema,
  type OdtCaller,
  odtCallerIdSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  RUNTIME_HOST_TRAITS_BY_KIND,
  type RuntimeKind,
} from "@openducktor/contracts";
import { normalizeOptionalInput } from "./path-utils";
import { OdtToolError } from "./tool-results";

const RUNTIME_KIND_ENV = "ODT_RUNTIME_KIND";
const RUNTIME_SESSION_ID_ENV = "ODT_RUNTIME_SESSION_ID";
const RUNTIME_CALLER_BINDING_ID_ENV = "ODT_RUNTIME_CALLER_BINDING_ID";

/** Finds the runtime session that made a tool call from the `_meta` of the call. */
export type RuntimeCallerResolver = (meta: RequestMeta | undefined) => OdtCaller;

const readRequiredEnvironmentId = (name: string, runtime: RuntimeKind): string => {
  const parsed = odtCallerIdSchema.safeParse(normalizeOptionalInput(process.env[name]));
  if (!parsed.success) {
    throw new Error(
      `${name} must name the calling session when ${RUNTIME_KIND_ENV} is ${runtime}.`,
    );
  }
  return parsed.data;
};

const unmanagedCallerError = (reason: string): OdtToolError =>
  new OdtToolError({
    code: "ODT_TOOL_EXECUTION_ERROR",
    message: `This tool needs a managed OpenDucktor session: ${reason}. Run the tool from an agent session that OpenDucktor started.`,
  });

/**
 * Reads the managed runtime that started this MCP process once, and returns how it names the
 * calling session, as the `mcpCaller` of its host traits says: in the environment of the process,
 * as the session or as a host-issued caller binding, or in the `_meta` of each call. Tool input
 * never selects the caller. External MCP clients set no runtime.
 */
export const readRuntimeCallerResolver = (): RuntimeCallerResolver | undefined => {
  const rawRuntime = normalizeOptionalInput(process.env[RUNTIME_KIND_ENV]);
  if (rawRuntime === undefined) {
    return undefined;
  }
  const parsedRuntime = knownRuntimeKindSchema.safeParse(rawRuntime);
  if (!parsedRuntime.success) {
    throw new Error(
      `${RUNTIME_KIND_ENV} must be one of: ${knownRuntimeKindSchema.options.join(", ")}.`,
    );
  }
  const runtime = parsedRuntime.data;
  const source = RUNTIME_HOST_TRAITS_BY_KIND[runtime].mcpCaller;
  switch (source.source) {
    case "process_binding": {
      const caller = {
        runtime,
        callerBindingId: readRequiredEnvironmentId(RUNTIME_CALLER_BINDING_ID_ENV, runtime),
      };
      return () => caller;
    }
    case "process_session": {
      const caller = {
        runtime,
        runtimeSessionId: readRequiredEnvironmentId(RUNTIME_SESSION_ID_ENV, runtime),
      };
      return () => caller;
    }
    case "call_meta":
      return (meta) => {
        const runtimeSessionId = odtCallerIdSchema.safeParse(meta?.[source.metaKey]);
        if (!runtimeSessionId.success) {
          throw unmanagedCallerError(
            `the ${RUNTIME_DESCRIPTORS_BY_KIND[runtime].label} call has no session ID in _meta["${source.metaKey}"]`,
          );
        }
        return { runtime, runtimeSessionId: runtimeSessionId.data };
      };
  }
};

/** The caller of a tool that needs one. A process that no OpenDucktor runtime started has none. */
export const requireRuntimeCaller = (
  resolveCaller: RuntimeCallerResolver | undefined,
  meta: RequestMeta | undefined,
): OdtCaller => {
  if (resolveCaller === undefined) {
    throw unmanagedCallerError(
      `this MCP server has no ${RUNTIME_KIND_ENV}, so OpenDucktor did not start it`,
    );
  }
  return resolveCaller(meta);
};
