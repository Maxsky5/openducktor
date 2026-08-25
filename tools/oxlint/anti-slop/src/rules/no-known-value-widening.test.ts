import { RuleTester } from "oxlint/plugins-dev";
import { fileURLToPath } from "node:url";

import { noKnownValueWideningRule } from "./no-known-value-widening.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const error = { messageId: "widening" };

const prelude = "type Command = () => void; const startCommand = () => {};";
const importedTypeFixtureFilename = fileURLToPath(
  new URL("./__fixtures__/no-known-value-widening-input.ts", import.meta.url),
);

tester.run("anti-slop/no-known-value-widening", noKnownValueWideningRule, {
  valid: [
    `${prelude} const commands: Record<string, Command> = {};`,
    `${prelude} type Index<T> = Record<string, T>; const commands: Index<Command> = {};`,
    `${prelude} class Registry { commands: Record<string, Command> = {}; }`,
    `${prelude} class Registry { accessor commands: Record<string, Command> = {}; }`,
    `${prelude} let commands: Record<string, Command>; commands = {};`,
    `${prelude} function create(): Record<string, Command> { return {}; }`,
    `${prelude} const create = (): Record<string, Command> => ({});`,
    `${prelude} const commands = {} as Record<string, Command>;`,
    `${prelude} const commands = <Record<string, Command>>{};`,
    `${prelude} const commands = { start: startCommand };`,
    `${prelude} const commands = { start: startCommand } as const;`,
    `${prelude} const commands = { start: startCommand } satisfies Record<string, Command>;`,
    `${prelude} type Commands = Record<string, Command>; const commands = { start: startCommand } as const satisfies Commands;`,
    `${prelude} interface Commands { readonly start: Command } const commands: Commands = { start: startCommand };`,
    `${prelude} interface Commands extends Record<'start', Command> {} const commands: Commands = { start: startCommand };`,
    `${prelude} interface Commands<Key extends PropertyKey> extends Record<Key, Command> {} const commands: Commands<'start'> = { start: startCommand };`,
    `${prelude} namespace Owner { export interface Commands<Key extends PropertyKey> extends Record<Key, Command> {} } interface Derived extends Owner.Commands<'start'> {} const commands: Derived = { start: startCommand };`,
    `${prelude} type Commands = { readonly start: Command }; const commands: Commands = { start: startCommand };`,
    `${prelude} type PermissionLevels = { readonly [Level in Permission]: number }; const levels: PermissionLevels = { admin: 1 };`,
    `${prelude} const commands: Record<'start', Command> = { start: startCommand };`,
    `${prelude} const commands: Record<Exclude<'start' | 'stop', 'stop'>, Command> = { start: startCommand };`,
    `${prelude} type Exclude<T, U> = 'only'; const commands: Record<Exclude<string, 'reserved'>, Command> = { only: startCommand };`,
    `${prelude} const commands: Record<string & 'only', Command> = { only: startCommand };`,
    'type Command = () => void; const startCommand = () => {}; const commands: Record<`key-${"start"}`, Command> = { "key-start": startCommand };',
    'type Command = () => void; const startCommand = () => {}; const commands: Record<`flag-${boolean}`, Command> = { "flag-false": startCommand, "flag-true": startCommand };',
    'type Command = () => void; const startCommand = () => {}; const commands: Record<`${null}-${undefined}`, Command> = { "null-undefined": startCommand };',
    `${prelude} const commands: Pick<Record<string, Command>, 'start'> = { start: startCommand };`,
    `${prelude} const commands: Omit<Record<string, Command>, string> = {};`,
    `${prelude} function create() { return { start: startCommand }; }`,
    `${prelude} interface Commands { readonly start: Command } function create(): Commands { return { start: startCommand }; }`,
    `${prelude} declare function make(): Record<string, Command>; const commands: Record<string, Command> = make();`,
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { ClosedCommands } from './no-known-value-widening-types'; const commands: ClosedCommands = { start: startCommand };`,
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommandsByKey } from './no-known-value-widening-types'; const commands: OpenCommandsByKey<'start'> = { start: startCommand };`,
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { InputKey } from './no-known-value-widening-types'; const commands: Pick<Record<string, Command>, InputKey> = { start: startCommand };`,
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommandsInterfaceByKey } from './no-known-value-widening-types'; const commands: OpenCommandsInterfaceByKey<'start'> = { start: startCommand };`,
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type * as CommandTypes from './no-known-value-widening-namespaces'; const commands: CommandTypes.OpenCommands = { start: startCommand }; const otherCommands: CommandTypes.Other.OpenCommands = { start: startCommand };`,
    },
    "function build() { type Record<Key, Value> = { value: Value }; type Command = () => void; const start = () => {}; const commands: Record<string, Command> = { value: start }; }",
    "namespace Owner { type Record<Key, Value> = { value: Value }; type Command = () => void; const start = () => {}; const commands: Record<string, Command> = { value: start }; }",
  ],
  invalid: [
    { code: "const value: unknown = {};", errors: [error] },
    { code: "const value: unknown & unknown = {};", errors: [error] },
    { code: "const { value }: Record<string, unknown> = { value: 1 };", errors: [error] },
    { code: "const value: object = {};", errors: [error] },
    { code: "let value: unknown; value = {};", errors: [error] },
    { code: "function create(): unknown { return {}; }", errors: [error] },
    {
      code: `${prelude} const commands: Record<string, Command> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: { [key: string]: Command } = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: { [K in string]: Command } = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: Record<keyof any, Command> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: Record<string & keyof any, Command> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: Record<Exclude<string, 'reserved'>, Command> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: Record<keyof never, Command> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: 'type Command = () => void; const startCommand = () => {}; const commands: Record<`key-${string}`, Command> = { "key-start": startCommand };',
      errors: [error],
    },
    {
      code: 'type Command = () => void; const startCommand = () => {}; const commands: Record<`id-${bigint}`, Command> = { "id-1": startCommand };',
      errors: [error],
    },
    {
      code: 'type Command = () => void; const startCommand = () => {}; const commands: Record<`foo-${string}` & `${string}-bar`, Command> = { "foo-value-bar": startCommand };',
      errors: [error],
    },
    {
      code: `${prelude} const commands: Pick<Record<string, Command>, string> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: Omit<Record<string, Command>, 'reserved'> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands: { start: Command } = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} const commands = { start: startCommand } as Record<string, Command>;`,
      errors: [error],
    },
    {
      code: `${prelude} const commands = ({ start: startCommand } as Record<string, Command>) as object;`,
      errors: 1,
    },
    {
      code: `${prelude} class Registry { commands: Record<string, Command> = { start: startCommand }; }`,
      errors: [error],
    },
    {
      code: `${prelude} let commands: Record<string, Command>; commands = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} function create(): Record<string, Command> { return { start: startCommand }; }`,
      errors: [error],
    },
    {
      code: `${prelude} function create(): { start: Command } { return { start: startCommand }; }`,
      errors: [error],
    },
    {
      code: `${prelude} const source = { start: startCommand }; const commands: Record<string, Command> = source;`,
      errors: [error],
    },
    {
      code: `${prelude} type Open = Record<string, Command>; const source = { start: startCommand }; const commands: Open = source;`,
      errors: [error],
    },
    {
      code: `${prelude} type Open = { [key: string]: Command }; const source = { start: startCommand }; const commands: Open = source;`,
      errors: [error],
    },
    {
      code: `${prelude} type Open = { [key in string]: Command }; const source = { start: startCommand }; const commands: Open = source;`,
      errors: [error],
    },
    {
      code: `${prelude} type Open = Readonly<Record<string, Command>>; const source = { start: startCommand }; const commands: Open = source;`,
      errors: [error],
    },
    {
      code: `${prelude} type Index<T> = Record<string, T>; const commands: Index<Command> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} type Index<T> = Record<string, T>; type CommandsByName = Index<Command>; const commands: CommandsByName = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} type Index<T = Command> = Record<string, T>; const commands: Index = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} type CommandName = string; const commands: Record<CommandName, Command> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} type Wrapper<Readonly> = Readonly; type Open = Wrapper<Record<string, Command>>; const commands: Open = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} interface CommandsContract extends Record<string, Command> {} const commands: CommandsContract = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} interface Commands<Key extends PropertyKey> extends Record<Key, Command> {} const commands: Commands<string> = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} interface CommandsContract { [key: string]: Command } const commands: CommandsContract = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} interface CommandsContract {} interface CommandsContract extends Record<string, Command> {} const commands: CommandsContract = { start: startCommand };`,
      errors: [error],
    },
    {
      code: `${prelude} type Open = Record<string, Command>; interface CommandsContract extends Open {} const commands: CommandsContract = { start: startCommand };`,
      errors: [error],
    },
    { code: "const value: unknown = 1;", errors: [error] },
    {
      code: "const value: unknown = condition ? { id: 1 } : { id: 2 };",
      errors: [error],
    },
    {
      code: "const source = { id: 1 }; const value: unknown = condition ? source : source;",
      errors: [error],
    },
    {
      code: "const source = { id: 1 }; const left = source; const right = source; const value: unknown = condition ? left : right;",
      errors: [error],
    },
    {
      code: "const left = { id: 1 }; const value: unknown = left || { id: 2 };",
      errors: [error],
    },
    {
      code: "const source = { id: 1 }; const value: unknown = source || source;",
      errors: [error],
    },
    { code: "const value: unknown = (prepare(), { id: 2 });", errors: [error] },
    { code: "const value: object = [];", errors: [error] },
    { code: "const value: unknown | string = {};", errors: [error] },
    { code: "const value = { answer: 42 } satisfies unknown;", errors: [error] },
    {
      code: "function build() { type Command = () => void; type Open = Record<string, Command>; const start = () => {}; const commands: Open = { start }; }",
      errors: [error],
    },
    {
      code: "namespace Owner { type Command = () => void; type Open = Record<string, Command>; const start = () => {}; const commands: Open = { start }; }",
      errors: [error],
    },
    {
      code: "type Command = () => void; const start = () => {}; namespace Owner { export type Open = Record<string, Command>; } const commands: Owner.Open = { start };",
      errors: [error],
    },
    {
      code: "type Command = () => void; const start = () => {}; namespace Owner { export interface Open extends Record<string, Command> {} } interface Derived extends Owner.Open {} const commands: Derived = { start };",
      errors: [error],
    },
    {
      code: "type Command = () => void; const start = () => {}; namespace Owner { export type Open<Key extends PropertyKey> = Record<Key, Command>; } interface Derived extends Owner.Open<string> {} const commands: Derived = { start };",
      errors: [error],
    },
    {
      code: "type Command = () => void; const start = () => {}; namespace Owner { export interface Open<Key extends PropertyKey> extends Record<Key, Command> {} } interface Derived extends Owner.Open<string> {} const commands: Derived = { start };",
      errors: [error],
    },
    {
      code: "function owner() { function Record() {} type Command = () => void; type Open = Record<string, Command>; const start = () => {}; const commands: Open = { start }; }",
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommands } from './no-known-value-widening-types'; const commands: OpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommandsByKey } from './no-known-value-widening-types'; const commands: OpenCommandsByKey<string> = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { StringKey } from './no-known-value-widening-types'; const commands: Pick<Record<string, Command>, StringKey> = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommandsInterfaceByKey } from './no-known-value-widening-types'; const commands: OpenCommandsInterfaceByKey<string> = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { ImportedKeyCommands, ImportedKeyCommandsInterface } from './no-known-value-widening-types'; const commands: ImportedKeyCommands = { start: startCommand }; const otherCommands: ImportedKeyCommandsInterface = { start: startCommand };`,
      errors: [error, error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type DefaultOpenCommands from './no-known-value-widening-types'; const commands: DefaultOpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommands } from './no-known-value-widening-types'; const commands = { start: startCommand } as OpenCommands;`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommands } from './no-known-value-widening-types'; const commands = <OpenCommands>{ start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommands } from './no-known-value-widening-types'; type Commands = OpenCommands; const commands: Commands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommandsByKey } from './no-known-value-widening-types'; type Commands<Key extends PropertyKey> = OpenCommandsByKey<Key>; const commands: Commands<string> = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type DefaultOpenCommands from './no-known-value-widening-reexports'; const commands: DefaultOpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { OpenCommandsByKey } from './no-known-value-widening-reexports'; const commands = { start: startCommand } as OpenCommandsByKey<string>;`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { WrappedCommandsByKey } from './no-known-value-widening-wrappers'; const commands: WrappedCommandsByKey<string> = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { WrappedOpenCommands } from './no-known-value-widening-wrappers'; const commands: WrappedOpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { WrappedDefaultOpenCommands } from './no-known-value-widening-wrappers'; const commands: WrappedDefaultOpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { NamespaceWrappedOpenCommands, NamespaceWrappedOpenCommandsInterface } from './no-known-value-widening-wrappers'; const commands: NamespaceWrappedOpenCommands = { start: startCommand }; const otherCommands: NamespaceWrappedOpenCommandsInterface = { start: startCommand };`,
      errors: [error, error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type * as CommandTypes from './no-known-value-widening-namespaces'; const commands: CommandTypes.Types.Owner.OpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type { Types } from './no-known-value-widening-namespaces'; const commands: Types.Owner.OpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type * as Reexports from './no-known-value-widening-namespace-reexports'; const commands: Reexports.Commands.Owner.OpenCommands = { start: startCommand };`,
      errors: [error],
    },
    {
      filename: importedTypeFixtureFilename,
      code: `${prelude} import type * as Reexports from './no-known-value-widening-namespace-reexports'; const commands: Reexports.NamespaceCommands.Types.Owner.OpenCommands = { start: startCommand };`,
      errors: [error],
    },
  ],
});
