export type ClosedCommands = { readonly start: () => void };
export type OpenCommands = Record<string, () => void>;
export type OpenCommandsByKey<Key extends PropertyKey> = {
  readonly [CommandName in Key]: () => void;
};
export interface OpenCommandsInterface extends Record<string, () => void> {}

interface DefaultOpenCommands extends Record<string, () => void> {}

export default DefaultOpenCommands;
