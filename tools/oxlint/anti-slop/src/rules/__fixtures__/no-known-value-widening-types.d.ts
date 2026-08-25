export type ClosedCommands = { readonly start: () => void };
export type OpenCommands = Record<string, () => void>;
export type OpenCommandsByKey<Key extends PropertyKey> = {
  readonly [CommandName in Key]: () => void;
};
export interface OpenCommandsInterface extends Record<string, () => void> {}
export interface OpenCommandsInterfaceByKey<Key extends PropertyKey> extends Record<
  Key,
  () => void
> {}
export type OpenCommandName = string;
export type ImportedKeyCommands = Record<OpenCommandName, () => void>;
export interface ImportedKeyCommandsInterface extends Record<OpenCommandName, () => void> {}

interface DefaultOpenCommands extends Record<string, () => void> {}

export default DefaultOpenCommands;
