import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeTranscriptJsonError } from "./claude-transcript-json";

export type ClaudeTranscriptWorkerOptions = { metadataOnly?: boolean; summaryOnly?: boolean };

export type ClaudeTranscriptWorkerRequest = { buffer: ArrayBuffer; byteLength: number };

export type ClaudeTranscriptWorkerBatch = {
  buffer: ArrayBuffer;
  records: ClaudeProtocolObject[];
  lineCount: number;
};

export type ClaudeTranscriptWorkerFailureReason =
  | ClaudeTranscriptJsonError["reason"]
  | "oversize"
  | "unterminated"
  | "replay"
  | "unexpected";

export type ClaudeTranscriptWorkerReply =
  | ({ kind: "complete" } & ClaudeTranscriptWorkerBatch)
  | {
      kind: "error";
      buffer: ArrayBuffer;
      error: {
        reason: ClaudeTranscriptWorkerFailureReason;
        lineIndex: number;
        cause: Error;
      };
    };
