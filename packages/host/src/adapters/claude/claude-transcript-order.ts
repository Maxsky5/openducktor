import { z } from "zod";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";

type PreservedMessages = { anchorUuid: string; uuids: readonly string[] };
type PreservedSegment = { anchorUuid: string; headUuid: string; tailUuid: string };

export type ClaudeTranscriptOrderMetadata = {
  type: string | undefined;
  subtype: string | undefined;
  uuid: string | undefined;
  parentUuid: string | undefined;
  hasParentUuid: boolean;
  isSidechain: boolean;
  teamName: string | undefined;
  agentId: string | undefined;
  attachmentType: string | undefined;
  responseId: string | undefined;
  toolUseIds: readonly string[];
  toolResultIds: readonly string[];
  sourceToolAssistantUuid: string | undefined;
  preservedMessages: PreservedMessages | undefined;
  preservedSegment: PreservedSegment | undefined;
};

const compactMetadataSchema = z.object({
  preservedMessages: z.object({ anchorUuid: z.string(), uuids: z.array(z.string()) }).optional(),
  preservedSegment: z
    .object({ anchorUuid: z.string(), headUuid: z.string(), tailUuid: z.string() })
    .optional(),
});

const metadataSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  isSidechain: z.boolean().optional(),
  teamName: z.string().optional(),
  agentId: z.string().optional(),
  sourceToolAssistantUUID: z.string().optional(),
  attachment: z.object({ type: z.string().optional() }).optional(),
  message: z
    .object({
      id: z.string().optional(),
      content: z
        .union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              id: z.string().optional(),
              tool_use_id: z.string().optional(),
            }),
          ),
        ])
        .optional(),
    })
    .optional(),
  compactMetadata: compactMetadataSchema.optional(),
  compact_metadata: compactMetadataSchema.optional(),
});

export const readClaudeTranscriptOrderMetadata = (
  record: ClaudeProtocolObject,
): ClaudeTranscriptOrderMetadata => {
  const parsed = metadataSchema.parse(record);
  const { message } = parsed;
  const compact = parsed.compactMetadata ?? parsed.compact_metadata;
  const toolUseIds: string[] = [];
  const toolResultIds: string[] = [];
  if (Array.isArray(message?.content)) {
    for (const block of message.content) {
      if (block.type === "tool_use" && block.id !== undefined) toolUseIds.push(block.id);
      if (block.type === "tool_result" && block.tool_use_id !== undefined)
        toolResultIds.push(block.tool_use_id);
    }
  }
  return {
    type: parsed.type,
    subtype: parsed.subtype,
    uuid: parsed.uuid,
    parentUuid: parsed.parentUuid ?? undefined,
    hasParentUuid: Object.hasOwn(record, "parentUuid"),
    isSidechain: parsed.isSidechain === true,
    teamName: parsed.teamName,
    agentId: parsed.agentId,
    attachmentType: parsed.attachment?.type,
    responseId: message?.id,
    toolUseIds,
    toolResultIds,
    sourceToolAssistantUuid: parsed.sourceToolAssistantUUID,
    preservedMessages: compact?.preservedMessages,
    preservedSegment: compact?.preservedSegment,
  };
};

type Entry = {
  index: number;
  metadata: ClaudeTranscriptOrderMetadata;
  parentUuid: string | undefined;
};
type Selection = { indices: Set<number>; boundaries: number[] };

const isConversation = (metadata: ClaudeTranscriptOrderMetadata): boolean =>
  metadata.type === "user" || metadata.type === "assistant";

const isBoundary = (metadata: ClaudeTranscriptOrderMetadata): boolean =>
  metadata.type === "system" && metadata.subtype === "compact_boundary";

const isGraphEntry = (metadata: ClaudeTranscriptOrderMetadata): boolean =>
  isConversation(metadata) ||
  metadata.type === "system" ||
  metadata.type === "attachment" ||
  metadata.type === "progress";

const sameAgent = (left: Entry, right: Entry): boolean =>
  left.metadata.isSidechain === right.metadata.isSidechain &&
  left.metadata.agentId === right.metadata.agentId;

const restoreParallelMessages = (
  graph: ReadonlyMap<string, Entry>,
  selected: Set<number>,
): void => {
  const responses = new Map<string, Entry>();
  const toolOwners = new Map<string, Entry | null>();
  for (const entry of graph.values()) {
    const { metadata } = entry;
    if (metadata.type !== "assistant" || !metadata.responseId) continue;
    if (selected.has(entry.index)) responses.set(metadata.responseId, entry);
    for (const id of metadata.toolUseIds) {
      const owner = toolOwners.get(id);
      toolOwners.set(
        id,
        owner === undefined || (owner && owner.metadata.responseId === metadata.responseId)
          ? entry
          : null,
      );
    }
  }
  for (const entry of graph.values()) {
    const { metadata } = entry;
    const response = metadata.responseId ? responses.get(metadata.responseId) : undefined;
    if (metadata.type === "assistant" && response && sameAgent(entry, response))
      selected.add(entry.index);
  }
  const coveredTools = new Set<string>();
  for (const entry of graph.values())
    if (selected.has(entry.index))
      for (const id of entry.metadata.toolResultIds) coveredTools.add(id);
  const restoredToolsByResponse = new Map<string, Set<string>>();
  const restoredTools = (responseId: string): Set<string> => {
    let ids = restoredToolsByResponse.get(responseId);
    if (!ids) {
      ids = new Set();
      restoredToolsByResponse.set(responseId, ids);
    }
    return ids;
  };
  for (const entry of graph.values()) {
    const parent = entry.parentUuid ? graph.get(entry.parentUuid) : undefined;
    if (
      entry.metadata.type === "user" &&
      entry.metadata.toolResultIds.length > 0 &&
      parent?.metadata.type === "assistant" &&
      selected.has(parent.index) &&
      sameAgent(entry, parent)
    ) {
      selected.add(entry.index);
      if (parent.metadata.responseId)
        for (const id of entry.metadata.toolResultIds)
          restoredTools(parent.metadata.responseId).add(id);
    }
  }
  for (const entry of graph.values()) {
    const { metadata } = entry;
    if (metadata.type !== "user" || selected.has(entry.index)) continue;
    let responseId: string | undefined;
    for (const id of metadata.toolResultIds) {
      const owner = toolOwners.get(id);
      if (
        owner?.metadata.responseId &&
        selected.has(owner.index) &&
        sameAgent(entry, owner) &&
        !coveredTools.has(id) &&
        !restoredTools(owner.metadata.responseId).has(id)
      ) {
        responseId = owner.metadata.responseId;
        break;
      }
    }
    if (responseId) {
      selected.add(entry.index);
      const covered = restoredTools(responseId);
      for (const id of metadata.toolResultIds) covered.add(id);
    }
  }
};

const restorePreservedParents = (graph: Map<string, Entry>): void => {
  for (const entry of graph.values()) {
    if (!isBoundary(entry.metadata)) continue;
    const { preservedMessages, preservedSegment } = entry.metadata;
    if (preservedMessages) {
      const { anchorUuid, uuids } = preservedMessages;
      if (uuids.length === 0 || uuids.some((uuid) => !graph.has(uuid))) continue;
      let parentUuid = anchorUuid;
      for (const uuid of uuids) {
        const preserved = graph.get(uuid);
        if (preserved) graph.set(uuid, { ...preserved, parentUuid });
        parentUuid = uuid;
      }
      for (const [uuid, child] of graph)
        if (child.parentUuid === anchorUuid && uuid !== uuids[0])
          graph.set(uuid, { ...child, parentUuid });
    } else if (preservedSegment) {
      const { anchorUuid, headUuid, tailUuid } = preservedSegment;
      const head = graph.get(headUuid);
      if (head) graph.set(headUuid, { ...head, parentUuid: anchorUuid });
      for (const [uuid, child] of graph)
        if (child.parentUuid === anchorUuid && uuid !== headUuid)
          graph.set(uuid, { ...child, parentUuid: tailUuid });
    }
  }
};

const selectPrefix = (
  records: readonly ClaudeTranscriptOrderMetadata[],
  end: number,
  includeSidechains: boolean,
): Selection => {
  const graph = new Map<string, Entry>();
  const allowed = (metadata: ClaudeTranscriptOrderMetadata): boolean =>
    (includeSidechains || !metadata.isSidechain) && !metadata.teamName;
  for (let index = 0; index < end; index++) {
    const metadata = records[index];
    if (metadata?.uuid && isGraphEntry(metadata))
      graph.set(metadata.uuid, { index, metadata, parentUuid: metadata.parentUuid });
  }
  restorePreservedParents(graph);
  const eligible = (entry: Entry): boolean =>
    allowed(entry.metadata) &&
    entry.metadata.type !== "progress" &&
    entry.metadata.attachmentType !== "fork_briefing";
  const parents = new Set<string>();
  for (const entry of graph.values())
    if (eligible(entry) && entry.parentUuid) parents.add(entry.parentUuid);
  let chain: Entry[] = [];
  for (let index = end - 1; index >= 0; index--) {
    const metadata = records[index];
    if (!metadata?.uuid) continue;
    const terminal = graph.get(metadata.uuid);
    if (!terminal || terminal.index !== index || !eligible(terminal) || parents.has(metadata.uuid))
      continue;
    const path: Entry[] = [];
    const visited = new Set<string>();
    let entry: Entry | undefined = terminal;
    while (entry?.metadata.uuid && !visited.has(entry.metadata.uuid)) {
      visited.add(entry.metadata.uuid);
      path.push(entry);
      entry = entry.parentUuid ? graph.get(entry.parentUuid) : undefined;
    }
    if (path.some((candidate) => isConversation(candidate.metadata))) {
      chain = path;
      break;
    }
  }
  const indices = new Set(chain.map((entry) => entry.index));
  const boundaries = chain
    .filter((entry) => isBoundary(entry.metadata))
    .map((entry) => entry.index);
  restoreParallelMessages(graph, indices);

  // Unlinked queue and result rows belong to the conversation segment that precedes them.
  let precedingConversation: number | undefined;
  const firstConversation = records.findIndex(isConversation);
  for (let index = 0; index < end; index++) {
    const metadata = records[index];
    if (!metadata) continue;
    if (isConversation(metadata)) {
      precedingConversation = index;
      continue;
    }
    if (!allowed(metadata) || isBoundary(metadata) || indices.has(index)) continue;
    if (metadata.uuid && graph.get(metadata.uuid)?.index !== index && isGraphEntry(metadata))
      continue;
    let parent = metadata.parentUuid ? graph.get(metadata.parentUuid) : undefined;
    if (parent && !isConversation(parent.metadata)) {
      const visited = new Set<number>();
      while (parent && !isConversation(parent.metadata) && !visited.has(parent.index)) {
        visited.add(parent.index);
        parent = parent.parentUuid ? graph.get(parent.parentUuid) : undefined;
      }
    }
    if (
      parent ? indices.has(parent.index) : indices.has(precedingConversation ?? firstConversation)
    )
      indices.add(index);
  }
  return { indices, boundaries };
};

export const selectClaudeTranscriptEntries = (
  records: readonly ClaudeTranscriptOrderMetadata[],
  options: { includeSidechains?: boolean } = {},
): Set<number> => {
  const includeSidechains = options.includeSidechains ?? false;
  const selected = new Set<number>();
  const latest = new Map<string, number>();
  for (let index = 0; index < records.length; index++) {
    const uuid = records[index]?.uuid;
    if (uuid) latest.set(uuid, index);
  }
  if (!records.some((record) => record.hasParentUuid)) {
    for (let index = 0; index < records.length; index++) {
      const metadata = records[index];
      if (metadata && (includeSidechains || !metadata.isSidechain) && !metadata.teamName)
        selected.add(index);
    }
  } else {
    const pending = [records.length];
    const visited = new Set<number>();
    while (pending.length > 0) {
      const end = pending.pop();
      if (end === undefined || visited.has(end)) continue;
      visited.add(end);
      const selection = selectPrefix(records, end, includeSidechains);
      for (const index of selection.indices) selected.add(index);
      pending.push(...selection.boundaries);
    }
  }
  return new Set(
    [...selected]
      .map((index) => {
        const uuid = records[index]?.uuid;
        return uuid ? (latest.get(uuid) ?? index) : index;
      })
      .sort((left, right) => left - right),
  );
};
