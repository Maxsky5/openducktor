export type CodexAppServerRequestInput = {
  runtimeId: string;
  method: string;
  params?: unknown;
};

export type CodexAppServerRespondInput = {
  runtimeId: string;
  requestId: number;
  result?: unknown;
  error?: unknown;
};

export type CodexAppServerPort = {
  request(input: CodexAppServerRequestInput): Promise<unknown>;
  drainNotifications(runtimeId: string): Promise<unknown[]>;
  drainServerRequests(runtimeId: string): Promise<unknown[]>;
  respond(input: CodexAppServerRespondInput): Promise<void>;
};
