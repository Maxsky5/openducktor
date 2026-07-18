import {
  type TerminalCloseRequest,
  type TerminalCloseResponse,
  type TerminalCreateRequest,
  type TerminalCreateResponse,
  type TerminalFailure,
  type TerminalListRequest,
  type TerminalListResponse,
  type TerminalPreparePathInputRequest,
  type TerminalPreparePathInputResponse,
  terminalCloseRequestSchema,
  terminalCloseResponseSchema,
  terminalCreateRequestSchema,
  terminalCreateResponseSchema,
  terminalListRequestSchema,
  terminalListResponseSchema,
  terminalPreparePathInputRequestSchema,
  terminalPreparePathInputResponseSchema,
} from "@openducktor/contracts";
import { HostInvokeError, type InvokeFn } from "./invoke-utils";

export class HostTerminalClientError extends Error {
  readonly code: TerminalFailure["code"];
  readonly failure: TerminalFailure;
  override readonly cause: unknown;

  constructor(failure: TerminalFailure, cause: unknown) {
    super(failure.message);
    this.name = "HostTerminalClientError";
    this.code = failure.code;
    this.failure = failure;
    this.cause = cause;
  }
}

export class HostTerminalClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  private async invoke<TResponse>(
    command: "terminal_create" | "terminal_list" | "terminal_prepare_path_input" | "terminal_close",
    request: Record<string, unknown>,
    parse: (value: unknown) => TResponse,
  ): Promise<TResponse> {
    try {
      return parse(await this.invokeFn(command, request));
    } catch (cause) {
      if (cause instanceof HostInvokeError && cause.failure?.kind === "terminal") {
        throw new HostTerminalClientError(cause.failure.terminalFailure, cause);
      }
      throw cause;
    }
  }

  async terminalCreate(input: TerminalCreateRequest): Promise<TerminalCreateResponse> {
    const request = terminalCreateRequestSchema.parse(input);
    return this.invoke("terminal_create", request, terminalCreateResponseSchema.parse);
  }

  async terminalList(input: TerminalListRequest): Promise<TerminalListResponse> {
    const request = terminalListRequestSchema.parse(input);
    return this.invoke("terminal_list", request, terminalListResponseSchema.parse);
  }

  async terminalPreparePathInput(
    input: TerminalPreparePathInputRequest,
  ): Promise<TerminalPreparePathInputResponse> {
    const request = terminalPreparePathInputRequestSchema.parse(input);
    return this.invoke(
      "terminal_prepare_path_input",
      request,
      terminalPreparePathInputResponseSchema.parse,
    );
  }

  async terminalClose(input: TerminalCloseRequest): Promise<TerminalCloseResponse> {
    const request = terminalCloseRequestSchema.parse(input);
    return this.invoke("terminal_close", request, terminalCloseResponseSchema.parse);
  }
}
