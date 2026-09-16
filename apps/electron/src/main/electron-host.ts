import {
  type CreateNodeHostCommandRouterInput,
  createNodeEffectHostCommandRouter,
  createNodeHostCommandRouter,
  type McpBridgeDiscoveryMode,
} from "@openducktor/host";

type ElectronHostCommandRouterInput<Input> = Input extends CreateNodeHostCommandRouterInput
  ? Omit<Input, "configDirScope" | "mcpBridgeDiscoveryMode"> & { isPackaged: boolean }
  : never;

export type CreateElectronHostCommandRouterInput =
  ElectronHostCommandRouterInput<CreateNodeHostCommandRouterInput>;

export const resolveElectronMcpBridgeDiscoveryMode = (
  isPackaged: boolean,
): McpBridgeDiscoveryMode => (isPackaged ? "production" : "development");

const toNodeHostInput = (
  input: CreateElectronHostCommandRouterInput,
): CreateNodeHostCommandRouterInput => {
  const { isPackaged, ...hostInput } = input;
  return {
    ...hostInput,
    configDirScope: isPackaged ? "production" : "dev",
    mcpBridgeDiscoveryMode: resolveElectronMcpBridgeDiscoveryMode(isPackaged),
  };
};

export const createElectronEffectHostCommandRouter = (
  input: CreateElectronHostCommandRouterInput,
) => createNodeEffectHostCommandRouter(toNodeHostInput(input));

export const createElectronHostCommandRouter = (input: CreateElectronHostCommandRouterInput) =>
  createNodeHostCommandRouter(toNodeHostInput(input));
