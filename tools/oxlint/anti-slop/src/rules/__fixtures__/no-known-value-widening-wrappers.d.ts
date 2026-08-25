import type DefaultOpenCommands from "./no-known-value-widening-types";
import type { OpenCommandsByKey, OpenCommandsInterface } from "./no-known-value-widening-types";
import type * as CommandTypes from "./no-known-value-widening-types";

export type WrappedCommandsByKey<Key extends PropertyKey> = OpenCommandsByKey<Key>;
export interface WrappedOpenCommands extends OpenCommandsInterface {}
export type WrappedDefaultOpenCommands = DefaultOpenCommands;
export type NamespaceWrappedOpenCommands = CommandTypes.OpenCommands;
export interface NamespaceWrappedOpenCommandsInterface extends CommandTypes.OpenCommandsInterface {}
