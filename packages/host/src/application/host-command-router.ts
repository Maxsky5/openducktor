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
  dispose(): Promise<void>;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
};

export type CreateHostCommandRouterInput = {
  dispose?: () => Promise<void> | void;
  handlers: HostCommandHandlers;
};

export const createHostCommandRouter = ({
  dispose,
  handlers,
}: CreateHostCommandRouterInput): HostCommandRouter => ({
  async dispose() {
    await dispose?.();
  },
  async invoke(command, args) {
    const hostCommand = parseHostCommandName(command);
    const handler = handlers[hostCommand];

    if (!handler) {
      throw new Error(`OpenDucktor TypeScript host command is not registered: ${hostCommand}`);
    }

    return handler(args, { command: hostCommand, args });
  },
});
