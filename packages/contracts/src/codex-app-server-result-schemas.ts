import { z } from "zod";
import {
  codexAppServerModelListResponseSchema,
  codexAppServerSkillsListResponseSchema,
  type CodexAppServerModelListResponse,
  type CodexAppServerSkillsListResponse,
} from "./codex-app-server-catalog-schemas";
import { codexUint32Schema } from "./codex-app-server-number-schemas";
import {
  codexAppServerApprovalPolicySchema,
  codexAppServerApprovalsReviewerSchema,
  codexAppServerMultiAgentModeSchema,
  codexAppServerReasoningEffortSchema,
  codexAppServerSandboxPolicySchema,
} from "./codex-app-server-request-schemas";
import {
  codexAppServerThreadSchema,
  codexAppServerTurnSchema,
} from "./codex-app-server-thread-schemas";
import type { JSONType } from "zod";

const codexAppServerActivePermissionProfileSchema = z.object({
  id: z.string(),
  extends: z.string().nullable(),
});
export type CodexAppServerActivePermissionProfile = z.output<
  typeof codexAppServerActivePermissionProfileSchema
>;

const codexAppServerTurnsPageSchema = z.object({
  data: z.array(codexAppServerTurnSchema),
  nextCursor: z.string().nullable(),
  backwardsCursor: z.string().nullable(),
});
export type CodexAppServerTurnsPage = z.output<typeof codexAppServerTurnsPageSchema>;

const codexAppServerThreadLaunchResultSchema = z.object({
  approvalPolicy: codexAppServerApprovalPolicySchema,
  approvalsReviewer: codexAppServerApprovalsReviewerSchema,
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
  initialTurnsPage: codexAppServerTurnsPageSchema.nullable().optional(),
  turnsBackwardsCursor: z.string().nullable().optional(),
  itemsBackwardsCursor: z.string().nullable().optional(),
});

const codexAppServerInitializeResponseSchema = z.object({
  codexHome: z.string(),
  platformFamily: z.string(),
  platformOs: z.string(),
  userAgent: z.string(),
});
const codexAppServerThreadListResponseSchema = z.object({
  backwardsCursor: z.string().nullable(),
  data: z.array(codexAppServerThreadSchema),
  nextCursor: z.string().nullable(),
});
const codexAppServerThreadLoadedListResponseSchema = z.object({
  data: z.array(z.string()),
  nextCursor: z.string().nullable(),
});
const codexAppServerThreadReadResponseSchema = z.object({ thread: codexAppServerThreadSchema });
const codexAppServerEmptyResponseSchema = z.object({});
const codexAppServerThreadTurnsListResponseSchema = z.object({
  backwardsCursor: z.string().nullable(),
  data: z.array(codexAppServerTurnSchema),
  nextCursor: z.string().nullable(),
});
const codexAppServerTurnStartResultSchema = z.object({ turn: codexAppServerTurnSchema });
const codexAppServerTurnSteerResultSchema = z.object({ turnId: z.string() });
const codexAppServerGitDiffToRemoteResponseSchema = z.object({
  diff: z.string(),
  sha: z.string(),
});
const codexAppServerFuzzyFileSearchResponseSchema = z.object({
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
});

export type CodexAppServerInitializeResponse = z.output<
  typeof codexAppServerInitializeResponseSchema
>;
export type CodexAppServerThreadStartResult = z.output<
  typeof codexAppServerThreadLaunchResultSchema
>;
export type CodexAppServerThreadResumeResult = z.output<
  typeof codexAppServerThreadResumeResultSchema
>;
export type CodexAppServerThreadForkResult = CodexAppServerThreadStartResult;
export type CodexAppServerThreadSetNameResult = z.output<typeof codexAppServerEmptyResponseSchema>;
export type CodexAppServerThreadCompactStartResult = CodexAppServerThreadSetNameResult;
export type CodexAppServerThreadListResponse = z.output<
  typeof codexAppServerThreadListResponseSchema
>;
export type CodexAppServerThreadLoadedListResponse = z.output<
  typeof codexAppServerThreadLoadedListResponseSchema
>;
export type CodexAppServerThreadReadResponse = z.output<
  typeof codexAppServerThreadReadResponseSchema
>;
export type CodexAppServerThreadTurnsListResponse = z.output<
  typeof codexAppServerThreadTurnsListResponseSchema
>;
export type CodexAppServerTurnStartResult = z.output<typeof codexAppServerTurnStartResultSchema>;
export type CodexAppServerTurnSteerResult = z.output<typeof codexAppServerTurnSteerResultSchema>;
export type CodexAppServerTurnInterruptResult = CodexAppServerThreadSetNameResult;
export type CodexAppServerGitDiffToRemoteResponse = z.output<
  typeof codexAppServerGitDiffToRemoteResponseSchema
>;
export type CodexAppServerFuzzyFileSearchResponse = z.output<
  typeof codexAppServerFuzzyFileSearchResponseSchema
>;
export type CodexAppServerFuzzyFileSearchResult =
  CodexAppServerFuzzyFileSearchResponse["files"][number];
export type CodexAppServerFuzzyFileSearchMatchType =
  CodexAppServerFuzzyFileSearchResult["match_type"];

export type CodexAppServerRequestResultMap = {
  initialize: CodexAppServerInitializeResponse;
  "model/list": CodexAppServerModelListResponse;
  "thread/fork": CodexAppServerThreadForkResult;
  "thread/list": CodexAppServerThreadListResponse;
  "thread/loaded/list": CodexAppServerThreadLoadedListResponse;
  "thread/read": CodexAppServerThreadReadResponse;
  "thread/resume": CodexAppServerThreadResumeResult;
  "thread/start": CodexAppServerThreadStartResult;
  "thread/name/set": CodexAppServerThreadSetNameResult;
  "thread/compact/start": CodexAppServerThreadCompactStartResult;
  "thread/turns/list": CodexAppServerThreadTurnsListResponse;
  "skills/list": CodexAppServerSkillsListResponse;
  "turn/start": CodexAppServerTurnStartResult;
  "turn/steer": CodexAppServerTurnSteerResult;
  "turn/interrupt": CodexAppServerTurnInterruptResult;
  gitDiffToRemote: CodexAppServerGitDiffToRemoteResponse;
  fuzzyFileSearch: CodexAppServerFuzzyFileSearchResponse;
};

type CodexAppServerRequestResultSchemaMap = {
  [Method in keyof CodexAppServerRequestResultMap]: z.ZodType<
    CodexAppServerRequestResultMap[Method]
  >;
};

const codexAppServerRequestResultSchemas: CodexAppServerRequestResultSchemaMap = {
  initialize: codexAppServerInitializeResponseSchema,
  "model/list": codexAppServerModelListResponseSchema,
  "thread/fork": codexAppServerThreadLaunchResultSchema,
  "thread/list": codexAppServerThreadListResponseSchema,
  "thread/loaded/list": codexAppServerThreadLoadedListResponseSchema,
  "thread/read": codexAppServerThreadReadResponseSchema,
  "thread/resume": codexAppServerThreadResumeResultSchema,
  "thread/start": codexAppServerThreadLaunchResultSchema,
  "thread/name/set": codexAppServerEmptyResponseSchema,
  "thread/compact/start": codexAppServerEmptyResponseSchema,
  "thread/turns/list": codexAppServerThreadTurnsListResponseSchema,
  "skills/list": codexAppServerSkillsListResponseSchema,
  "turn/start": codexAppServerTurnStartResultSchema,
  "turn/steer": codexAppServerTurnSteerResultSchema,
  "turn/interrupt": codexAppServerEmptyResponseSchema,
  gitDiffToRemote: codexAppServerGitDiffToRemoteResponseSchema,
  fuzzyFileSearch: codexAppServerFuzzyFileSearchResponseSchema,
};

export const codexAppServerRequestResultSchemaFor = <
  Method extends keyof CodexAppServerRequestResultSchemaMap,
>(
  method: Method,
): CodexAppServerRequestResultSchemaMap[Method] => codexAppServerRequestResultSchemas[method];

export const parseCodexAppServerRequestResult = <
  Method extends keyof CodexAppServerRequestResultSchemaMap,
>(
  method: Method,
  value: JSONType | CodexAppServerRequestResultMap[keyof CodexAppServerRequestResultMap],
): CodexAppServerRequestResultMap[Method] =>
  codexAppServerRequestResultSchemaFor(method).parse(value);
