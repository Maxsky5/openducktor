import type { AgentToolPart } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useMemo } from "react";
import { errorMessage } from "../../lib/errors";
import {
  sessionToolPartQueryOptions,
  type ToolPartSession,
} from "../../queries/agent-session-tool-part";
import { toToolMessageMeta } from "../agent-orchestrator/support/tool-messages";
import { useAgentOperationsContext } from "../session-contexts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";

/** The session of the transcript. Each transcript view provides it to its tool rows. */
export const ToolPartSessionContext = createContext<ToolPartSession | null>(null);

export type ToolPartDetails = {
  /** The row meta with the full details once they are read. */
  meta: ToolMeta;
  /** Why the full details could not be read. */
  error: string | null;
  /** Reads the full details again after a failure. */
  retry: () => void;
};

const withFullDetails = (meta: ToolMeta, part: AgentToolPart): ToolMeta => {
  const full: ToolMeta = { ...meta, ...toToolMessageMeta(part) };
  delete full.detailsOmitted;
  return full;
};

/**
 * The full details of a row that compact history cut, which has `detailsOmitted`. Mount it only
 * for such a row. It reads the full part from the host while `read` is true, as when the user
 * opens its details. With `read` false, it still shows a part that another view of the row read.
 */
export const useToolPartDetails = (meta: ToolMeta, read: boolean): ToolPartDetails => {
  const session = use(ToolPartSessionContext);
  const { readSessionToolPart } = useAgentOperationsContext();
  const queryClient = useQueryClient();
  if (!session)
    throw new Error("A transcript with cut tool details must provide ToolPartSessionContext.");
  const {
    data: part,
    error,
    refetch,
  } = useQuery({
    ...sessionToolPartQueryOptions(session, meta, readSessionToolPart, queryClient),
    enabled: read,
  });
  const merged = useMemo(() => (part ? withFullDetails(meta, part) : meta), [meta, part]);
  return {
    meta: merged,
    error: error ? errorMessage(error) : null,
    retry: () => void refetch(),
  };
};
