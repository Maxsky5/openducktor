import {
  type CreateNodeHostCommandRouterInput,
  createNodeEffectHostCommandRouter,
  createNodeHostCommandRouter,
  type McpBridgeDiscoveryMode,
} from "@openducktor/host";

type ElectronHostCommandRouterInput<Input> = Input extends CreateNodeHostCommandRouterInput
  ? Omit<Input, "mcpBridgeDiscoveryMode"> & { isPackaged: boolean }
  : never;

export type CreateElectronHostCommandRouterInput =
  ElectronHostCommandRouterInput<CreateNodeHostCommandRouterInput>;

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
