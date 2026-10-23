import type { RequestMeta } from "@modelcontextprotocol/sdk/types.js";
import { type OdtBrowserCaller, odtBrowserCallerSchema } from "@openducktor/contracts";
import { z } from "zod";
import { normalizeOptionalInput } from "./path-utils";
import { OdtToolError } from "./tool-results";

const RUNTIME_KIND_ENV = "ODT_RUNTIME_KIND";
const RUNTIME_SESSION_ID_ENV = "ODT_RUNTIME_SESSION_ID";
const OPENCODE_SESSION_ID_META_KEY = "ai.opencode/sessionID";

const runtimeSessionIdSchema = odtBrowserCallerSchema.shape.runtimeSessionId;
/** OpenCode sends the ID of the calling session with each `tools/call`. */
const opencodeCallMetaSchema = z.object({ [OPENCODE_SESSION_ID_META_KEY]: runtimeSessionIdSchema });
/** Codex sends the ID of the calling thread with each model tool call. */
const codexCallMetaSchema = z.object({ threadId: runtimeSessionIdSchema });

/**
 * The managed runtime that started this MCP process. OpenCode and Codex share one MCP
 * process between sessions, so each call names its session. Claude starts one MCP process
 * for each session, so the process environment names it.
 */
export type RuntimeCallerSource =
  | { runtime: Exclude<OdtBrowserCaller["runtime"], "claude"> }
  | { runtime: "claude"; runtimeSessionId: string };

/** Reads the managed runtime of this process. External MCP clients set no runtime. */
export const readRuntimeCallerSource = (): RuntimeCallerSource | undefined => {
  const rawRuntime = normalizeOptionalInput(process.env[RUNTIME_KIND_ENV]);
  if (rawRuntime === undefined) {
    return undefined;
  }
  const runtime = odtBrowserCallerSchema.shape.runtime.safeParse(rawRuntime);
  if (!runtime.success) {
    throw new Error(`${RUNTIME_KIND_ENV} must be opencode, codex, or claude.`);
  }
  if (runtime.data !== "claude") {
    return { runtime: runtime.data };
  }
  const runtimeSessionId = runtimeSessionIdSchema.safeParse(
    normalizeOptionalInput(process.env[RUNTIME_SESSION_ID_ENV]),
  );
  if (!runtimeSessionId.success) {
    throw new Error(
      `${RUNTIME_SESSION_ID_ENV} must name the Claude session when ${RUNTIME_KIND_ENV} is claude.`,
    );
  }
  return { runtime: "claude", runtimeSessionId: runtimeSessionId.data };
};

const unmanagedCallerError = (reason: string): OdtToolError =>
  new OdtToolError({
    code: "ODT_TOOL_EXECUTION_ERROR",
    message: `This tool needs a managed OpenDucktor session: ${reason}. Run the tool from an agent session that OpenDucktor started.`,
  });

/** Finds the runtime session that made a tool call. Tool input never selects it. */
export const resolveNativeCaller = (
  source: RuntimeCallerSource | undefined,
  meta: RequestMeta | undefined,
): OdtBrowserCaller => {
  if (source === undefined) {
    throw unmanagedCallerError(
      `this MCP server has no ${RUNTIME_KIND_ENV}, so OpenDucktor did not start it`,
    );
  }
  switch (source.runtime) {
    case "claude":
      return { runtime: "claude", runtimeSessionId: source.runtimeSessionId };
    case "opencode": {
      const parsed = opencodeCallMetaSchema.safeParse(meta);
      if (!parsed.success) {
        throw unmanagedCallerError(
          `the OpenCode call has no session ID in _meta["${OPENCODE_SESSION_ID_META_KEY}"]`,
        );
      }
      return {
        runtime: "opencode",
        runtimeSessionId: parsed.data[OPENCODE_SESSION_ID_META_KEY],
      };
    }
    case "codex": {
      const parsed = codexCallMetaSchema.safeParse(meta);
      if (!parsed.success) {
        throw unmanagedCallerError("the Codex call has no thread ID in _meta.threadId");
      }
      return { runtime: "codex", runtimeSessionId: parsed.data.threadId };
    }
  }
};
