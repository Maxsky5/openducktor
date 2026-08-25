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
export interface UnknownPayload {
  readonly input: unknown;
}
export interface InheritedUnknownPayload extends UnknownPayload {}
export type UnknownArray = ReadonlyArray<unknown>;
export type PickedUnknownPayload = Pick<UnknownPayload, "input">;
export type BroadObject = object;
export interface KnownOwner {
  readonly id: string;
}
export namespace OwnerTypes {
  export type BroadObject = object;
  export interface KnownOwner {
    readonly id: string;
  }
}

interface DefaultOpenCommands extends Record<string, () => void> {}

export default DefaultOpenCommands;
