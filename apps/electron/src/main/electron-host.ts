import {
  type CreateNodeHostCommandRouterInput,
  createNodeEffectHostCommandRouter,
  createNodeHostCommandRouter,
  type McpBridgeDiscoveryMode,
} from "@openducktor/host";

export type CreateElectronHostCommandRouterInput = Omit<
  CreateNodeHostCommandRouterInput,
  "mcpBridgeDiscoveryMode"
> & {
  isPackaged: boolean;
};

export const resolveElectronMcpBridgeDiscoveryMode = (
  isPackaged: boolean,
): McpBridgeDiscoveryMode => (isPackaged ? "production" : "development");

const withElectronMcpBridgeDiscoveryMode = (
  input: CreateElectronHostCommandRouterInput,
): CreateNodeHostCommandRouterInput => {
  const { isPackaged, ...hostInput } = input;
  return {
    ...hostInput,
    mcpBridgeDiscoveryMode: resolveElectronMcpBridgeDiscoveryMode(isPackaged),
  };
};

export const createElectronEffectHostCommandRouter = (
  input: CreateElectronHostCommandRouterInput,
) => createNodeEffectHostCommandRouter(withElectronMcpBridgeDiscoveryMode(input));

export const createElectronHostCommandRouter = (input: CreateElectronHostCommandRouterInput) =>
  createNodeHostCommandRouter(withElectronMcpBridgeDiscoveryMode(input));
