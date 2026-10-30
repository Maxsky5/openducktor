import type { AgentToolPart } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useMemo } from "react";
import { errorMessage } from "../../lib/errors";
import {
  sessionToolPartQueryOptions,
  type ToolPartSession,
} from "../../queries/agent-session-tool-part";
import { skippedQueryOptions } from "../../queries/skipped-query";
import { toToolMessageMeta } from "../agent-orchestrator/support/tool-messages";
import { useAgentOperationsContext } from "../session-contexts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

/** The session of the transcript. Each transcript view provides it to its tool rows. */
export const ToolPartSessionContext = createContext<ToolPartSession | null>(null);

export type ToolPartDetails = {
  /** The row meta with the full details once they are read. */
  meta: ToolMeta;
  /** True while a read of cut details runs. */
  loading: boolean;
  /** Why the full details could not be read. */
  error: string | null;
  /** Reads the full details again after a failure. */
  retry: () => void;
};

const skippedToolPartQueryOptions = skippedQueryOptions<AgentToolPart>({
  queryKey: ["agent-session-tool-part", "skipped"] as const,
  staleTime: Number.POSITIVE_INFINITY,
});

const withFullDetails = (meta: ToolMeta, part: AgentToolPart): ToolMeta => {
  const full: ToolMeta = { ...meta, ...toToolMessageMeta(part) };
  delete full.detailsOmitted;
  return full;
};

/**
 * The details of a tool row. Compact history cuts long tool details and marks the row with
 * `detailsOmitted`. Such a row reads its full part from the host while `read` is true, as when
 * the user opens its details. With `read` false, the row still shows a part that another view of
 * the same row read.
 */
export const useToolPartDetails = (meta: ToolMeta, read: boolean): ToolPartDetails => {
  const session = use(ToolPartSessionContext);
  const { readSessionToolPart } = useAgentOperationsContext();
  const queryClient = useQueryClient();
  const omitted = meta.detailsOmitted === true;
  if (omitted && !session)
    throw new Error("A transcript with cut tool details must provide ToolPartSessionContext.");
  const query = useQuery(
    omitted && session
      ? {
          ...sessionToolPartQueryOptions(session, meta, readSessionToolPart, queryClient),
          enabled: read,
        }
      : skippedToolPartQueryOptions,
  );
  const part = omitted ? query.data : undefined;
  const merged = useMemo(() => (part ? withFullDetails(meta, part) : meta), [meta, part]);
  const { refetch } = query;
  return {
    meta: merged,
    loading: omitted && read && !part && query.error === null,
    error: omitted && query.error ? errorMessage(query.error) : null,
    retry: () => void refetch(),
  };
};
