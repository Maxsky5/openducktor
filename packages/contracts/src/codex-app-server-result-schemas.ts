import { z } from "zod";
import {
  codexAppServerModelListResponseSchema,
  codexAppServerSkillsListResponseSchema,
} from "./codex-app-server-catalog-schemas";
import { codexUint32Schema } from "./codex-app-server-number-schemas";
import {
  codexAppServerMultiAgentModeSchema,
  codexAppServerReasoningEffortSchema,
} from "./codex-app-server-request-schemas";
import {
  codexAppServerThreadSchema,
  codexAppServerTurnSchema,
} from "./codex-app-server-thread-schemas";
import type { JsonValue } from "./json-types";

const codexAppServerAskForApprovalSchema = z.union([
  z.enum(["never", "on-request", "untrusted"]),
  z.object({
    granular: z.object({
      mcp_elicitations: z.boolean(),
      request_permissions: z.boolean(),
      rules: z.boolean(),
      sandbox_approval: z.boolean(),
      skill_approval: z.boolean(),
    }),
  }),
]);

const codexAppServerSandboxPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dangerFullAccess") }),
  z.object({
    type: z.literal("externalSandbox"),
    networkAccess: z.enum(["restricted", "enabled"]),
  }),
  z.object({ type: z.literal("readOnly"), networkAccess: z.boolean() }),
  z.object({
    type: z.literal("workspaceWrite"),
    excludeSlashTmp: z.boolean(),
    excludeTmpdirEnvVar: z.boolean(),
    networkAccess: z.boolean(),
    writableRoots: z.array(z.string()),
  }),
]);

const codexAppServerActivePermissionProfileSchema = z.object({
  id: z.string(),
  extends: z.string().nullable(),
});

const codexAppServerTurnsPageSchema = z.object({
  data: z.array(codexAppServerTurnSchema),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable(),
});

const codexAppServerThreadLaunchResultSchema = z.object({
  approvalPolicy: codexAppServerAskForApprovalSchema,
  approvalsReviewer: z.enum(["auto_review", "guardian_subagent", "user"]),
  activePermissionProfile: codexAppServerActivePermissionProfileSchema.nullable(),
  cwd: z.string(),
  instructionSources: z.array(z.string()),
  model: z.string(),
  modelProvider: z.string(),
  multiAgentMode: codexAppServerMultiAgentModeSchema,
  reasoningEffort: codexAppServerReasoningEffortSchema.nullable(),
  runtimeWorkspaceRoots: z.array(z.string()),
  sandbox: codexAppServerSandboxPolicySchema,
  serviceTier: z.string().nullable(),
  thread: codexAppServerThreadSchema,
});

const codexAppServerThreadResumeResultSchema = codexAppServerThreadLaunchResultSchema.extend({
  initialTurnsPage: codexAppServerTurnsPageSchema.nullable(),
  turnsBackwardsCursor: z.string().nullable(),
  itemsBackwardsCursor: z.string().nullable(),
});

const codexAppServerRequestResultSchemas = {
  initialize: z.object({
    codexHome: z.string(),
    platformFamily: z.string(),
    platformOs: z.string(),
    userAgent: z.string(),
  }),
  "model/list": codexAppServerModelListResponseSchema,
  "thread/fork": codexAppServerThreadLaunchResultSchema,
  "thread/list": z.object({
    backwardsCursor: z.string().nullable(),
    data: z.array(codexAppServerThreadSchema),
    nextCursor: z.string().nullable(),
  }),
  "thread/loaded/list": z.object({
    data: z.array(z.string()),
    nextCursor: z.string().nullable(),
  }),
  "thread/read": z.object({ thread: codexAppServerThreadSchema }),
  "thread/resume": codexAppServerThreadResumeResultSchema,
  "thread/start": codexAppServerThreadLaunchResultSchema,
  "thread/name/set": z.object({}).strict(),
  "thread/compact/start": z.object({}).strict(),
  "thread/turns/list": z.object({
    backwardsCursor: z.string().nullable(),
    data: z.array(codexAppServerTurnSchema),
    nextCursor: z.string().nullable(),
  }),
  "skills/list": codexAppServerSkillsListResponseSchema,
  "turn/start": z.object({ turn: codexAppServerTurnSchema }),
  "turn/steer": z.object({ turnId: z.string() }),
  "turn/interrupt": z.object({}).strict(),
  gitDiffToRemote: z.object({ diff: z.string(), sha: z.string() }),
  fuzzyFileSearch: z.object({
    files: z.array(
      z.object({
        root: z.string(),
        path: z.string(),
        match_type: z.enum(["file", "directory"]),
        file_name: z.string(),
        score: codexUint32Schema,
        indices: z.array(codexUint32Schema).nullable(),
      }),
    ),
  }),
};

export type CodexAppServerRequestResultMap = {
  [Method in keyof typeof codexAppServerRequestResultSchemas]: z.output<
    (typeof codexAppServerRequestResultSchemas)[Method]
  >;
};
type CodexAppServerRequestResultSchemaMap = typeof codexAppServerRequestResultSchemas;
type CodexAppServerParsedRequestResult =
  CodexAppServerRequestResultMap[keyof CodexAppServerRequestResultMap];

export const codexAppServerRequestResultSchema = z.union([
  codexAppServerRequestResultSchemas.initialize,
  codexAppServerRequestResultSchemas["model/list"],
  codexAppServerRequestResultSchemas["thread/fork"],
  codexAppServerRequestResultSchemas["thread/list"],
  codexAppServerRequestResultSchemas["thread/loaded/list"],
  codexAppServerRequestResultSchemas["thread/read"],
  codexAppServerRequestResultSchemas["thread/resume"],
  codexAppServerRequestResultSchemas["thread/start"],
  codexAppServerRequestResultSchemas["thread/name/set"],
  codexAppServerRequestResultSchemas["thread/compact/start"],
  codexAppServerRequestResultSchemas["thread/turns/list"],
  codexAppServerRequestResultSchemas["skills/list"],
  codexAppServerRequestResultSchemas["turn/start"],
  codexAppServerRequestResultSchemas["turn/steer"],
  codexAppServerRequestResultSchemas["turn/interrupt"],
  codexAppServerRequestResultSchemas.gitDiffToRemote,
  codexAppServerRequestResultSchemas.fuzzyFileSearch,
]);

export function parseCodexAppServerRequestResultValue<
  Method extends keyof CodexAppServerRequestResultSchemaMap,
>(
  method: Method,
  value: JsonValue | CodexAppServerParsedRequestResult,
): CodexAppServerRequestResultMap[Method];
export function parseCodexAppServerRequestResultValue(
  method: keyof CodexAppServerRequestResultSchemaMap,
  value: JsonValue | CodexAppServerParsedRequestResult,
) {
  switch (method) {
    case "initialize":
      return codexAppServerRequestResultSchemas.initialize.parse(value);
    case "model/list":
      return codexAppServerRequestResultSchemas["model/list"].parse(value);
    case "thread/fork":
      return codexAppServerRequestResultSchemas["thread/fork"].parse(value);
    case "thread/list":
      return codexAppServerRequestResultSchemas["thread/list"].parse(value);
    case "thread/loaded/list":
      return codexAppServerRequestResultSchemas["thread/loaded/list"].parse(value);
    case "thread/read":
      return codexAppServerRequestResultSchemas["thread/read"].parse(value);
    case "thread/resume":
      return codexAppServerRequestResultSchemas["thread/resume"].parse(value);
    case "thread/start":
      return codexAppServerRequestResultSchemas["thread/start"].parse(value);
    case "thread/name/set":
      return codexAppServerRequestResultSchemas["thread/name/set"].parse(value);
    case "thread/compact/start":
      return codexAppServerRequestResultSchemas["thread/compact/start"].parse(value);
    case "thread/turns/list":
      return codexAppServerRequestResultSchemas["thread/turns/list"].parse(value);
    case "skills/list":
      return codexAppServerRequestResultSchemas["skills/list"].parse(value);
    case "turn/start":
      return codexAppServerRequestResultSchemas["turn/start"].parse(value);
    case "turn/steer":
      return codexAppServerRequestResultSchemas["turn/steer"].parse(value);
    case "turn/interrupt":
      return codexAppServerRequestResultSchemas["turn/interrupt"].parse(value);
    case "gitDiffToRemote":
      return codexAppServerRequestResultSchemas.gitDiffToRemote.parse(value);
    case "fuzzyFileSearch":
      return codexAppServerRequestResultSchemas.fuzzyFileSearch.parse(value);
  }
}
