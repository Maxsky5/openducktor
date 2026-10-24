export type AgentSessionTransientFault = {
  message: string;
  source?: "workspace-target";
  statusUnavailable?: boolean;
};
