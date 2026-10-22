import { Buffer } from "node:buffer";
import { parentPort, workerData } from "node:worker_threads";
import {
  ClaudeTranscriptJsonError,
  createClaudeTranscriptJsonReader,
} from "./claude-transcript-json";
import type {
  ClaudeTranscriptWorkerBatch,
  ClaudeTranscriptWorkerFailureReason,
  ClaudeTranscriptWorkerOptions,
  ClaudeTranscriptWorkerReply,
  ClaudeTranscriptWorkerRequest,
} from "./claude-transcript-worker-protocol";

const port = parentPort;
if (!port) throw new Error("The Claude transcript parser must run in a worker thread.");
// SAFETY: The private pool supplies these options through the worker constructor.
const options = workerData as ClaudeTranscriptWorkerOptions;
const maxRecordBytes = 2 * 1024 * 1024;

port.on("message", (request: ClaudeTranscriptWorkerRequest) => {
  let lineIndex = 0;
  let reason: ClaudeTranscriptWorkerFailureReason = "unexpected";
  let reply: ClaudeTranscriptWorkerReply;
  try {
    const source = Buffer.from(request.buffer, 0, request.byteLength);
    const records: ClaudeTranscriptWorkerBatch["records"] = [];
    let start = 0;
    while (start < source.length) {
      const end = source.indexOf(10, start);
      if (end < 0) {
        reason = "unterminated";
        throw new Error("A Claude transcript worker batch must end with a line feed.");
      }
      if (end - start > maxRecordBytes) {
        reason = "oversize";
        throw new Error("A Claude transcript worker record exceeds 2 MiB of source bytes.");
      }
      reason = "unexpected";
      const reader = createClaudeTranscriptJsonReader(options);
      reader.write(source.toString("utf8", start, end));
      const result = reader.finish();
      if (result.kind !== "complete") {
        reason = "replay";
        throw new Error("A Claude transcript worker record requested a source replay.");
      }
      if (result.record !== null) records.push(result.record);
      lineIndex++;
      start = end + 1;
    }
    reply = { kind: "complete", buffer: request.buffer, records, lineCount: lineIndex };
  } catch (cause) {
    reply = {
      kind: "error",
      buffer: request.buffer,
      error: {
        reason: cause instanceof ClaudeTranscriptJsonError ? cause.reason : reason,
        lineIndex,
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      },
    };
  }
  port.postMessage(reply, [request.buffer]);
});
