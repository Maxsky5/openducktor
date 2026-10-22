import type { BrowserFailure, BrowserFailureCode } from "@openducktor/contracts";
import { Data } from "effect";

export class BrowserServiceError extends Data.TaggedError("BrowserServiceError")<{
  readonly code: BrowserFailureCode;
  readonly operation: string;
  readonly message: string;
  readonly tabId?: string | undefined;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}> {}

export const browserServiceErrorToFailure = (error: BrowserServiceError): BrowserFailure => {
  const failure: BrowserFailure = { code: error.code, message: error.message };
  if (error.tabId !== undefined) {
    failure.tabId = error.tabId;
  }
  if (error.details !== undefined) {
    failure.details = { ...error.details };
  }
  return failure;
};
