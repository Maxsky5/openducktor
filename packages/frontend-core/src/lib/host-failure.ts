import { HOST_UNREACHABLE_MESSAGE } from "@openducktor/host-client";
import { isConnectionFailure } from "./command-outcome";
import { errorMessage } from "./errors";

export type HostFailureKind = "host-unreachable" | "other";

/** A failure that keeps its cause after the original error is gone. */
export type HostFeedbackFailure = {
  kind: HostFailureKind;
  message: string;
};

/** The shared event stream lost its connection to the host. */
export const HOST_UNREACHABLE_FAILURE: HostFeedbackFailure = {
  kind: "host-unreachable",
  message: HOST_UNREACHABLE_MESSAGE,
};

/** A host-unreachable failure keeps the one shared message. Other failures keep their own. */
export const toHostFeedbackFailure = (
  cause: unknown,
  describe: (message: string) => string = (message) => message,
): HostFeedbackFailure =>
  isConnectionFailure(cause)
    ? HOST_UNREACHABLE_FAILURE
    : { kind: "other", message: describe(errorMessage(cause)) };

/** Quiet text for a view that waits for the host connection. */
export const HOST_CONNECTION_WAITING_MESSAGE = "Waiting for the host connection...";

/** Background work waits quietly for the connection. The connection indicator explains it. */
export const isQuietHostFailure = (failure: HostFeedbackFailure | null): boolean =>
  failure?.kind === "host-unreachable";

/** A failure that its view must show, because the host connection did not cause it. */
export const reportsFailure = (
  failure: HostFeedbackFailure | null,
): failure is HostFeedbackFailure => failure !== null && !isQuietHostFailure(failure);

/** The text of a failure. A lost host connection shows the quiet waiting text. */
export const failureText = (failure: HostFeedbackFailure): string =>
  isQuietHostFailure(failure) ? HOST_CONNECTION_WAITING_MESSAGE : failure.message;

/** The text of a failure, or null without one. */
export const failureTextOf = (failure: HostFeedbackFailure | null): string | null =>
  failure === null ? null : failureText(failure);

/** True when both failures have the same cause and message. */
export const sameHostFailure = (
  left: HostFeedbackFailure | null,
  right: HostFeedbackFailure | null,
): boolean => left?.kind === right?.kind && left?.message === right?.message;

/** The text of a failure cause. A lost host connection shows the quiet waiting text. */
export const hostFailureText = (cause: unknown, describe?: (message: string) => string): string =>
  failureText(toHostFeedbackFailure(cause, describe));

/** The failure to show: another failure wins over a quiet wait for the host. */
export const selectHostFailure = (
  ...failures: Array<HostFeedbackFailure | null>
): HostFeedbackFailure | null =>
  failures.find(reportsFailure) ?? failures.find((failure) => failure !== null) ?? null;

/** The message to show for a failure. A lost host connection shows none. */
export const reportedFailureMessage = (failure: HostFeedbackFailure | null): string | null =>
  reportsFailure(failure) ? failure.message : null;
