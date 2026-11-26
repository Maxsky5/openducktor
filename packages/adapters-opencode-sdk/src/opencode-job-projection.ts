import type {
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageSynthetic,
} from "@opencode/client";
import type { AgentTranscriptStreamPart } from "@openducktor/contracts";
import { z } from "zod";

type ToolPart = Extract<AgentTranscriptStreamPart, { kind: "tool" }>;

// Mirrors the calls of OpenCode 2.4.1 that complete when their background job starts: image and
// video generation, and a Code Mode script that moved to the background. The call result holds the
// job ID, and the job result arrives later as a notice.
const jobToolSchema = z.enum(["generate_image", "generate_video", "execute"]);
export type JobTool = z.infer<typeof jobToolSchema>;
const jobCallMetadataSchema = z.object({ jobID: z.string().min(1) });

/** The notice source of the job of each tool, and the `kind` that wraps its result. */
const noticeKinds = { generate_image: "image", generate_video: "video", codemode: "codemode" };
const jobSourceSchema = z.enum(["generate_image", "generate_video", "codemode"]);
const jobNoticeMetadataSchema = z.object({
  source: jobSourceSchema,
  jobID: z.string().min(1),
  state: z.enum(["completed", "cancelled", "error"]),
});

/** The job that a completed call started, or undefined for a call that started none. */
export const callJob = (
  part: SessionMessageAssistantTool,
): { tool: JobTool; jobID: string } | undefined => {
  const tool = jobToolSchema.safeParse(part.name).data;
  if (tool === undefined || part.state.status !== "completed") return undefined;
  const jobID = jobCallMetadataSchema.safeParse(part.state.metadata).data?.jobID;
  return jobID === undefined ? undefined : { tool, jobID };
};

/** Tells if notice metadata comes from a background job of a known source. */
export const isJobNoticeSource = (metadata: SessionMessageSynthetic["metadata"]): boolean =>
  jobSourceSchema.safeParse(metadata?.source).success;

/** Reads the metadata of a job notice. A notice of a known source with other metadata fails. */
export const readJobNotice = (
  noticeId: string,
  metadata: SessionMessageSynthetic["metadata"],
): z.infer<typeof jobNoticeMetadataSchema> => {
  const parsed = jobNoticeMetadataSchema.safeParse(metadata);
  if (!parsed.success)
    throw new Error(
      `OpenCode returned invalid background job result metadata for '${noticeId}': ${z.prettifyError(parsed.error)} Check the job in OpenCode, then reload this conversation.`,
    );
  return parsed.data;
};

type JobResult = {
  noticeId: string;
  endedAtMs: number;
  state: z.infer<typeof jobNoticeMetadataSchema>["state"];
  output: string;
};

export type JobContext = {
  /** The result of each call whose job ended, by tool call ID. */
  results: ReadonlyMap<string, JobResult>;
  /** The notices that a call card shows, so the transcript hides them. */
  hidden: ReadonlySet<string>;
};

export const isJobNotice = (message: SessionMessageInfo): message is SessionMessageSynthetic =>
  message.type === "synthetic" && isJobNoticeSource(message.metadata);

const parseResult = (message: SessionMessageSynthetic): JobResult & { jobID: string } => {
  const notice = readJobNotice(message.id, message.metadata);
  // `BackgroundResult.render` wraps the job result for the model.
  const prefix = `<background-result kind="${noticeKinds[notice.source]}" id="${notice.jobID}" state="${notice.state}">\n`;
  const suffix = "\n</background-result>";
  if (!message.text.startsWith(prefix) || !message.text.endsWith(suffix))
    throw new Error(
      `OpenCode returned an invalid background job result envelope for '${message.id}'. Check the job in OpenCode, then reload this conversation.`,
    );
  return {
    jobID: notice.jobID,
    noticeId: message.id,
    endedAtMs: message.time.created,
    state: notice.state,
    output: message.text.slice(prefix.length, -suffix.length),
  };
};

/** Links each job result notice to the call that started its job. */
export const jobContext = (messages: readonly SessionMessageInfo[]): JobContext => {
  const calls = new Map<string, string>();
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool") continue;
      const job = callJob(part);
      if (job) calls.set(job.jobID, part.id);
    }
  }
  const results = new Map<string, JobResult>();
  const hidden = new Set<string>();
  for (const message of messages) {
    if (!isJobNotice(message)) continue;
    const { jobID, ...result } = parseResult(message);
    const callID = calls.get(jobID);
    if (callID === undefined) continue;
    results.set(callID, result);
    hidden.add(message.id);
  }
  return { results, hidden };
};

/**
 * A call shows the result of its job when the job sends one. A call whose job sent none shows as
 * OpenCode reports it: the background task shows the running job, and a cancelled Code Mode job
 * or a result that a stop cancelled sends none.
 */
export const updateJobTool = (
  native: SessionMessageAssistantTool,
  tool: ToolPart,
  context?: JobContext,
): void => {
  if (!callJob(native)) return;
  const result = context?.results.get(native.id);
  if (!result) return;
  const completed = result.state === "completed";
  tool.status = completed ? "completed" : "error";
  tool.output = result.output;
  tool.resultContent = [{ kind: "text", text: result.output }];
  tool.endedAtMs = result.endedAtMs;
  tool.metadata = {
    ...tool.metadata,
    backgroundTaskStatus: completed
      ? "completed"
      : result.state === "cancelled"
        ? "stopped"
        : "failed",
  };
  if (completed) delete tool.error;
  else tool.error = result.output;
};
