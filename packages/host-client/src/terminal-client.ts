import {
  type TerminalCloseRequest,
  type TerminalCloseResponse,
  type TerminalCreateRequest,
  type TerminalCreateResponse,
  type TerminalListRequest,
  type TerminalListResponse,
  terminalCloseRequestSchema,
  terminalCloseResponseSchema,
  terminalCreateRequestSchema,
  terminalCreateResponseSchema,
  terminalListRequestSchema,
  terminalListResponseSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

export class HostTerminalClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async terminalCreate(input: TerminalCreateRequest): Promise<TerminalCreateResponse> {
    const request = terminalCreateRequestSchema.parse(input);
    return terminalCreateResponseSchema.parse(await this.invokeFn("terminal_create", request));
  }

  async terminalList(input: TerminalListRequest): Promise<TerminalListResponse> {
    const request = terminalListRequestSchema.parse(input);
    return terminalListResponseSchema.parse(await this.invokeFn("terminal_list", request));
  }

  async terminalClose(input: TerminalCloseRequest): Promise<TerminalCloseResponse> {
    const request = terminalCloseRequestSchema.parse(input);
    return terminalCloseResponseSchema.parse(await this.invokeFn("terminal_close", request));
  }
}
