import type { BrowserWaitCondition } from "@openducktor/contracts";
import { Data, type Effect } from "effect";
import type { CdpPayload } from "./browser-engine-port";

/** A CDP command from the automation client to the proxy. */
type BrowserAutomationCommand = {
  readonly id: number;
  readonly method: string;
  readonly params?: CdpPayload | undefined;
  readonly sessionId?: string | undefined;
};

/** A CDP response or event from the proxy to the automation client. */
export type BrowserAutomationMessage =
  | { id: number; result: CdpPayload; sessionId?: string }
  | { id: number; error: { code: number; message: string }; sessionId?: string }
  | { method: string; params: CdpPayload; sessionId?: string };

/** The in-process CDP transport of one agent proxy client. It opens no network port. */
export type BrowserAutomationTransport = {
  send(command: BrowserAutomationCommand): void;
  /** Sets the one receiver of proxy messages. */
  receive(listener: (message: BrowserAutomationMessage) => void): void;
  /** Sets the one receiver of the end of the transport. */
  onClose(listener: (reason: string) => void): void;
  close(): void;
};

export class BrowserAutomationError extends Data.TaggedError("BrowserAutomationError")<{
  /** `ref_stale`: the element ref is not in the latest snapshot or no longer matches the page. */
  readonly kind: "ref_stale" | "timeout" | "failed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

type BrowserAutomationClickOptions = {
  readonly button: "left" | "right" | "middle";
  readonly doubleClick: boolean;
  readonly modifiers: readonly ("Alt" | "Control" | "Meta" | "Shift")[];
};

type BrowserAutomationPoint = { readonly x: number; readonly y: number };

/** One page of an automation client. Element refs come from the latest `snapshot`. */
export type BrowserAutomationPage = {
  snapshot(timeoutMs: number): Effect.Effect<string, BrowserAutomationError>;
  /** The center of the element in CSS pixels of the viewport, or null when it is not visible. */
  elementPoint(
    ref: string,
    timeoutMs: number,
  ): Effect.Effect<BrowserAutomationPoint | null, BrowserAutomationError>;
  click(
    ref: string,
    options: BrowserAutomationClickOptions,
    timeoutMs: number,
  ): Effect.Effect<void, BrowserAutomationError>;
  hover(ref: string, timeoutMs: number): Effect.Effect<void, BrowserAutomationError>;
  /** Replaces the value of the field. */
  fill(ref: string, text: string, timeoutMs: number): Effect.Effect<void, BrowserAutomationError>;
  /** Presses a key on the element, or on the page when `ref` is null. */
  press(
    ref: string | null,
    key: string,
    timeoutMs: number,
  ): Effect.Effect<void, BrowserAutomationError>;
  selectOptions(
    ref: string,
    values: readonly string[],
    timeoutMs: number,
  ): Effect.Effect<readonly string[], BrowserAutomationError>;
  scrollIntoView(ref: string, timeoutMs: number): Effect.Effect<void, BrowserAutomationError>;
  scrollBy(deltaX: number, deltaY: number): Effect.Effect<void, BrowserAutomationError>;
  /** A PNG image in CSS pixels of the page viewport, or of one element. */
  screenshot(
    ref: string | null,
    timeoutMs: number,
  ): Effect.Effect<Uint8Array, BrowserAutomationError>;
  waitFor(
    condition: BrowserWaitCondition,
    timeoutMs: number,
  ): Effect.Effect<void, BrowserAutomationError>;
  close(): Effect.Effect<void>;
};

export type BrowserAutomationPort = {
  /** Connects an automation client to a proxy transport that holds one page target. */
  connect(
    proxy: BrowserAutomationTransport,
    timeoutMs: number,
  ): Effect.Effect<BrowserAutomationPage, BrowserAutomationError>;
};
