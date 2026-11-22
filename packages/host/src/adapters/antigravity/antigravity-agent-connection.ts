import type { ClientConnection, ClientContext } from "@agentclientprotocol/sdk/unstable";
import { describeAntigravityRequestError } from "./antigravity-native-contract";

/**
 * The ACP connection to one shared `agy acp` process. The runtime starter attaches it after the
 * `initialize` check, and a runtime release closes it for every session.
 */
export class AntigravityAgentConnection {
  private connection: ClientConnection | null = null;
  private released = false;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  attach(connection: ClientConnection): void {
    this.connection = connection;
  }

  release(): void {
    this.released = true;
  }

  get isReleased(): boolean {
    return this.released;
  }

  now(): string {
    return this.clock().toISOString();
  }

  agent(): ClientContext {
    if (!this.connection || this.released) {
      throw new Error(
        "The Antigravity runtime is not connected. Restart the runtime, then try again.",
      );
    }
    return this.connection.agent;
  }

  /** Runs one ACP request and gives a failure the user action of Antigravity. */
  async request<Result>(run: () => Promise<Result>): Promise<Result> {
    try {
      return await run();
    } catch (cause) {
      throw new Error(describeAntigravityRequestError(cause), { cause });
    }
  }

  /** True when the connection to the runtime closed. */
  transportClosed(): boolean {
    return this.connection?.signal.aborted === true;
  }
}
