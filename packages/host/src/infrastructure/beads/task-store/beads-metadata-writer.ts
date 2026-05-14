import { gzipSync } from "node:zlib";
import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type DirectMergeRecord,
  directMergeRecordSchema,
  type PullRequest,
  pullRequestSchema,
  type QaReportVerdict,
  type TaskCard,
  type TaskMetadataDocument,
  type TaskStatus,
} from "@openducktor/contracts";
import { documentsMetadata } from "./beads-documents";
import {
  DOCUMENT_ENCODING_GZIP_BASE64_V1,
  isRecord,
  METADATA_NAMESPACE,
  ODT_QA_APPROVED_SOURCE_TOOL,
  ODT_QA_REJECTED_SOURCE_TOOL,
  ODT_SET_PLAN_SOURCE_TOOL,
  ODT_SET_SPEC_SOURCE_TOOL,
  type RunBdJson,
} from "./beads-raw-issue";
import { parseAgentSessionsMetadata, parseTaskCard, showRawIssue } from "./beads-task-mapping";

export const metadataRoot = (metadata: unknown): Record<string, unknown> =>
  isRecord(metadata) ? { ...metadata } : {};

export const namespaceMap = (root: Record<string, unknown>): Record<string, unknown> => {
  const namespace = root[METADATA_NAMESPACE];
  return isRecord(namespace) ? { ...namespace } : {};
};

export const writeMetadata = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  metadata: Record<string, unknown>,
): Promise<void> => {
  await runBdJson(repoPath, ["update", "--metadata", JSON.stringify(metadata), "--", taskId]);
};

export const loadNamespace = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<{
  root: Record<string, unknown>;
  namespace: Record<string, unknown>;
}> => {
  const issue = await showRawIssue(runBdJson, repoPath, taskId);
  const root = metadataRoot(issue.metadata);
  return {
    root,
    namespace: namespaceMap(root),
  };
};

export const nextDocumentRevision = (value: unknown, metadataPath: string): number => {
  if (value === undefined) {
    return 1;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid existing ${metadataPath} metadata: expected an array`);
  }

  let maxRevision = 0;
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      throw new Error(
        `Invalid existing ${metadataPath} metadata at index ${index}: expected an object`,
      );
    }
    const revision = entry.revision;
    if (revision === undefined) {
      continue;
    }
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision <= 0) {
      throw new Error(
        `Invalid existing ${metadataPath} metadata at index ${index}: revision must be a positive integer`,
      );
    }
    maxRevision = Math.max(maxRevision, revision);
  }

  return maxRevision + 1;
};

export const writeDocumentWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
  taskId: string,
  markdown: string,
  documentKey: "spec" | "implementationPlan",
): Promise<TaskMetadataDocument> => {
  const trimmed = markdown.trim();
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documentsPath = `${METADATA_NAMESPACE}.documents.${documentKey}`;
  const documents = documentsMetadata(namespace) ? { ...documentsMetadata(namespace) } : {};
  const revision = nextDocumentRevision(documents[documentKey], documentsPath);
  const updatedAt = now().toISOString();
  const sourceTool = documentKey === "spec" ? ODT_SET_SPEC_SOURCE_TOOL : ODT_SET_PLAN_SOURCE_TOOL;

  documents[documentKey] = [
    {
      markdown: gzipSync(trimmed).toString("base64"),
      encoding: DOCUMENT_ENCODING_GZIP_BASE64_V1,
      updatedAt,
      updatedBy: "planner-agent",
      sourceTool,
      revision,
    },
  ];
  namespace.documents = documents;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return {
    markdown: trimmed,
    updatedAt,
    revision,
  };
};

export const qaReportSourceTool = (verdict: QaReportVerdict): string =>
  verdict === "approved" ? ODT_QA_APPROVED_SOURCE_TOOL : ODT_QA_REJECTED_SOURCE_TOOL;

export const writeLatestQaReport = (
  now: () => Date,
  documents: Record<string, unknown>,
  markdown: string,
  verdict: QaReportVerdict,
): void => {
  const documentsPath = `${METADATA_NAMESPACE}.documents.qaReports`;
  const revision = nextDocumentRevision(documents.qaReports, documentsPath);
  const trimmed = markdown.trim();

  documents.qaReports = [
    {
      markdown: gzipSync(trimmed).toString("base64"),
      encoding: DOCUMENT_ENCODING_GZIP_BASE64_V1,
      verdict,
      updatedAt: now().toISOString(),
      updatedBy: "qa-agent",
      sourceTool: qaReportSourceTool(verdict),
      revision,
    },
  ];
};

export const recordQaOutcomeWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
  taskId: string,
  status: TaskStatus,
  markdown: string,
  verdict: QaReportVerdict,
): Promise<TaskCard> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documents = documentsMetadata(namespace) ? { ...documentsMetadata(namespace) } : {};
  writeLatestQaReport(now, documents, markdown, verdict);
  namespace.documents = documents;
  root[METADATA_NAMESPACE] = namespace;

  await runBdJson(repoPath, [
    "update",
    "--status",
    status,
    "--metadata",
    JSON.stringify(root),
    "--",
    taskId,
  ]);

  return parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
};

export const compactAgentSessionForStorage = (session: AgentSessionRecord): AgentSessionRecord => {
  const role = session.role.trim();
  if (!role) {
    throw new Error("Agent session role is required");
  }

  const externalSessionId = session.externalSessionId.trim();
  if (!externalSessionId) {
    throw new Error("Agent session externalSessionId is required");
  }

  const startedAt = session.startedAt.trim();
  if (!startedAt) {
    throw new Error("Agent session startedAt is required");
  }

  const runtimeKind = session.runtimeKind.trim();
  if (!runtimeKind) {
    throw new Error("Agent session runtimeKind is required");
  }

  const workingDirectory = session.workingDirectory.trim();
  if (!workingDirectory) {
    throw new Error("Agent session workingDirectory is required");
  }

  const selectedModel =
    session.selectedModel === null
      ? null
      : {
          ...session.selectedModel,
          runtimeKind: session.selectedModel.runtimeKind.trim(),
        };
  if (selectedModel !== null && !selectedModel.runtimeKind) {
    throw new Error("Agent session selectedModel.runtimeKind is required");
  }

  return agentSessionRecordSchema.parse({
    ...session,
    externalSessionId,
    role,
    startedAt,
    runtimeKind,
    workingDirectory,
    selectedModel,
  });
};

export const upsertAgentSessionWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): Promise<boolean> => {
  const compactSession = compactAgentSessionForStorage(session);
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const sessions = parseAgentSessionsMetadata(taskId, namespace);
  const existingIndex = sessions.findIndex(
    (entry) => entry.externalSessionId === compactSession.externalSessionId,
  );

  if (existingIndex >= 0) {
    sessions[existingIndex] = compactSession;
  } else {
    sessions.push(compactSession);
  }

  namespace.agentSessions = sessions
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, 100);
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

export const setPullRequestWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  pullRequest: PullRequest | null,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  if (pullRequest === null) {
    delete namespace.pullRequest;
  } else {
    namespace.pullRequest = pullRequestSchema.parse(pullRequest);
    delete namespace.directMerge;
  }
  delete namespace.delivery;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

export const setDirectMergeWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  directMerge: DirectMergeRecord | null,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  if (directMerge === null) {
    delete namespace.directMerge;
  } else {
    namespace.directMerge = directMergeRecordSchema.parse(directMerge);
    delete namespace.pullRequest;
  }
  delete namespace.delivery;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

export const clearAgentSessionsByRolesWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  roles: string[],
): Promise<boolean> => {
  const roleSet = new Set(roles.map((role) => role.trim()).filter(Boolean));
  if (roleSet.size === 0) {
    return true;
  }

  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const sessions = parseAgentSessionsMetadata(taskId, namespace);
  const remainingSessions = sessions.filter((session) => !roleSet.has(session.role.trim()));
  if (remainingSessions.length === 0) {
    delete namespace.agentSessions;
  } else {
    namespace.agentSessions = remainingSessions;
  }

  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

export const clearWorkflowDocumentsWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documents = isRecord(namespace.documents) ? { ...namespace.documents } : undefined;
  if (!documents) {
    return true;
  }

  delete documents.spec;
  delete documents.implementationPlan;
  delete documents.qaReports;
  if (Object.keys(documents).length === 0) {
    delete namespace.documents;
  } else {
    namespace.documents = documents;
  }

  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

export const clearQaReportsWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documents = isRecord(namespace.documents) ? { ...namespace.documents } : undefined;
  if (!documents) {
    return true;
  }

  delete documents.qaReports;
  if (Object.keys(documents).length === 0) {
    delete namespace.documents;
  } else {
    namespace.documents = documents;
  }

  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};
