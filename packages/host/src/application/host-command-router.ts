import { type HostCommandName, parseHostCommandName } from "../commands/host-command-names";

export type HostCommandArgs = Record<string, unknown> | undefined;

export type HostCommandContext = {
  command: HostCommandName;
  args: HostCommandArgs;
};

export type HostCommandHandler = (
  args: HostCommandArgs,
  context: HostCommandContext,
) => Promise<unknown> | unknown;

export type HostCommandHandlers = Partial<Record<HostCommandName, HostCommandHandler>>;

export type HostCommandRouter = {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
};

export type CreateHostCommandRouterInput = {
  handlers: HostCommandHandlers;
};

export const createHostCommandRouter = ({
  handlers,
}: CreateHostCommandRouterInput): HostCommandRouter => ({
  async invoke(command, args) {
    const hostCommand = parseHostCommandName(command);
    const handler = handlers[hostCommand];

    if (!handler) {
      throw new Error(`OpenDucktor TypeScript host command is not registered: ${hostCommand}`);
    }

    return handler(args, { command: hostCommand, args });
  },
});
