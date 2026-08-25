import type { ESTree } from "@oxlint/plugins";

import type {
  PortableClass,
  PortableModuleItem,
  PortableNode,
  PortableTSInterfaceDeclaration,
  PortableTSModuleDeclaration,
  PortableTSType,
  PortableTSTypeAliasDeclaration,
  PortableTSTypeName,
  PortableTSTypeReference,
} from "./portable-ast.ts";
import { lexicalStructuralTypeParameterNames } from "./lexical-type-parameters.ts";

const BUILT_INS = new Set([
  "Array",
  "Exclude",
  "NonNullable",
  "Omit",
  "Partial",
  "Pick",
  "Promise",
  "PromiseLike",
  "PropertyKey",
  "Readonly",
  "ReadonlyArray",
  "Record",
  "Required",
]);

export const TRANSPARENT_TYPE_WRAPPERS: ReadonlySet<string> = new Set([
  "Readonly",
  "Partial",
  "Required",
  "NonNullable",
]);

export type PortableTypeEnvironment = {
  readonly aliases: ReadonlyMap<string, PortableTSTypeAliasDeclaration>;
  readonly classes: ReadonlyMap<string, readonly PortableClass[]>;
  readonly declaredTypeNames: ReadonlySet<string>;
  readonly importedTypeNames: ReadonlySet<string>;
  readonly interfaces: ReadonlyMap<string, readonly PortableTSInterfaceDeclaration[]>;
  readonly namespaces: ReadonlyMap<string, readonly PortableTSModuleDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
  readonly visitorKeys: Readonly<Record<string, readonly string[]>>;
};

export type PortableTypeArgument = {
  readonly environment: PortableTypeEnvironment;
  readonly resolveImportedType: PortableTypeResolver | undefined;
  readonly substitutions: TypeSubstitutions;
  readonly type: PortableTSType;
};

export type ResolvedPortableType =
  | {
      readonly arguments: readonly PortableTypeArgument[];
      readonly declaration: PortableTSTypeAliasDeclaration;
      readonly environment: PortableTypeEnvironment;
      readonly key: string;
      readonly kind: "alias";
      readonly resolveImportedType: PortableTypeResolver | undefined;
    }
  | {
      readonly arguments: readonly PortableTypeArgument[];
      readonly declarations: readonly PortableTSInterfaceDeclaration[];
      readonly environment: PortableTypeEnvironment;
      readonly key: string;
      readonly kind: "interface";
      readonly name: string;
      readonly resolveImportedType: PortableTypeResolver | undefined;
    };

export type PortableTypeResolver = (
  typeNameParts: readonly string[],
  arguments_: readonly PortableTypeArgument[],
) => ResolvedPortableType | null;

export type TypeSubstitutions = ReadonlyMap<string, PortableTypeArgument>;

const environmentIds = new WeakMap<PortableTypeEnvironment, number>();
let nextEnvironmentId = 1;

function environmentId(environment: PortableTypeEnvironment): number {
  const existing = environmentIds.get(environment);
  if (existing !== undefined) return existing;
  const id = nextEnvironmentId;
  nextEnvironmentId += 1;
  environmentIds.set(environment, id);
  return id;
}

function localResolutionKey(
  environment: PortableTypeEnvironment,
  parts: readonly string[],
): string {
  return `local\0${environmentId(environment)}\0${parts.join("\0")}`;
}

function declaration(statement: PortableModuleItem): PortableNode | null {
  return statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
    ? (statement.declaration ?? null)
    : statement;
}

function declarationName(node: PortableNode): string | null {
  if (node.type === "ImportDeclaration") return null;
  if (
    node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSInterfaceDeclaration" ||
    node.type === "TSEnumDeclaration" ||
    node.type === "ClassDeclaration"
  ) {
    return node.id?.name ?? null;
  }
  if (node.type === "TSImportEqualsDeclaration") return node.id.name;
  return null;
}

/** Build the declaration index used by portable type queries. */
export function createPortableModuleTypeEnvironment(
  statements: readonly PortableModuleItem[],
  visitorKeys: Readonly<Record<string, readonly string[]>> = {},
): PortableTypeEnvironment {
  const aliases = new Map<string, PortableTSTypeAliasDeclaration>();
  const classes = new Map<string, PortableClass[]>();
  const interfaces = new Map<string, PortableTSInterfaceDeclaration[]>();
  const namespaces = new Map<string, PortableTSModuleDeclaration[]>();
  const typeNames = new Set<string>();
  const importedTypeNames = new Set<string>();
  const competingInterfaceNames = new Set<string>();

  for (const statement of statements) {
    const node = declaration(statement);
    if (node?.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        typeNames.add(specifier.local.name);
        importedTypeNames.add(specifier.local.name);
        competingInterfaceNames.add(specifier.local.name);
      }
      continue;
    }
    if (node === null) continue;
    if (
      node.type === "TSModuleDeclaration" &&
      node.global === false &&
      node.id.type === "Identifier"
    ) {
      const declarations = namespaces.get(node.id.name) ?? [];
      declarations.push(node);
      namespaces.set(node.id.name, declarations);
      continue;
    }
    const name = declarationName(node);
    if (name === null) continue;
    typeNames.add(name);
    if (node.type === "TSTypeAliasDeclaration") {
      aliases.set(name, node);
      competingInterfaceNames.add(name);
      continue;
    }
    if (node.type === "TSInterfaceDeclaration") {
      const declarations = interfaces.get(name) ?? [];
      declarations.push(node);
      interfaces.set(name, declarations);
      continue;
    }
    if (node.type === "ClassDeclaration") {
      const declarations = classes.get(name) ?? [];
      declarations.push(node);
      classes.set(name, declarations);
      continue;
    }
    competingInterfaceNames.add(name);
  }

  for (const name of competingInterfaceNames) interfaces.delete(name);
  return {
    aliases,
    classes,
    declaredTypeNames: typeNames,
    interfaces,
    importedTypeNames,
    namespaces,
    shadowedBuiltIns: new Set([...typeNames].filter((name) => BUILT_INS.has(name))),
    visitorKeys,
  };
}

function scopeStatements(node: ESTree.Node): readonly ESTree.Statement[] | null {
  if (
    node.type === "Program" ||
    node.type === "BlockStatement" ||
    node.type === "StaticBlock" ||
    node.type === "TSModuleBlock"
  ) {
    return node.body;
  }
  return node.type === "SwitchStatement" ? node.cases.flatMap((case_) => case_.consequent) : null;
}

function shadowTypeName(
  name: string,
  environment: {
    aliases: Map<string, PortableTSTypeAliasDeclaration>;
    classes: Map<string, readonly PortableClass[]>;
    interfaces: Map<string, readonly PortableTSInterfaceDeclaration[]>;
    namespaces: Map<string, readonly PortableTSModuleDeclaration[]>;
    importedTypeNames: Set<string>;
    shadowedBuiltIns: Set<string>;
  },
): void {
  environment.aliases.delete(name);
  environment.classes.delete(name);
  environment.interfaces.delete(name);
  environment.namespaces.delete(name);
  environment.importedTypeNames.delete(name);
  if (BUILT_INS.has(name)) environment.shadowedBuiltIns.add(name);
}

function emptyTypeEnvironment(
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): PortableTypeEnvironment {
  return {
    aliases: new Map(),
    classes: new Map(),
    declaredTypeNames: new Set(),
    importedTypeNames: new Set(),
    interfaces: new Map(),
    namespaces: new Map(),
    shadowedBuiltIns: new Set(),
    visitorKeys,
  };
}

function extendTypeEnvironment(
  environment: PortableTypeEnvironment,
  statements: readonly PortableModuleItem[],
): PortableTypeEnvironment {
  const aliases = new Map(environment.aliases);
  const classes = new Map(environment.classes);
  const declaredTypeNames = new Set(environment.declaredTypeNames);
  const importedTypeNames = new Set(environment.importedTypeNames);
  const interfaces = new Map(environment.interfaces);
  const namespaces = new Map(environment.namespaces);
  const shadowedBuiltIns = new Set(environment.shadowedBuiltIns);
  const mutable = {
    aliases,
    classes,
    importedTypeNames,
    interfaces,
    namespaces,
    shadowedBuiltIns,
  };
  const layer = createPortableModuleTypeEnvironment(statements, environment.visitorKeys);
  for (const name of layer.declaredTypeNames) {
    shadowTypeName(name, mutable);
    declaredTypeNames.add(name);
  }
  for (const name of layer.importedTypeNames) importedTypeNames.add(name);
  for (const [name, alias] of layer.aliases) aliases.set(name, alias);
  for (const [name, declarations] of layer.classes) classes.set(name, declarations);
  for (const [name, declarations] of layer.interfaces) interfaces.set(name, declarations);
  for (const [name, declarations] of layer.namespaces) namespaces.set(name, declarations);
  return {
    aliases,
    classes,
    declaredTypeNames,
    importedTypeNames,
    interfaces,
    namespaces,
    shadowedBuiltIns,
    visitorKeys: environment.visitorKeys,
  };
}

/** Build the visible TypeScript type declarations at one AST node. */
export function createTypeEnvironment(
  node: ESTree.Node,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): PortableTypeEnvironment {
  let visible = emptyTypeEnvironment(visitorKeys);
  const ancestry: ESTree.Node[] = [];
  let current: ESTree.Node | null = node;
  while (current !== null) {
    ancestry.push(current);
    current = current.parent;
  }

  for (const ancestor of ancestry.reverse()) {
    const statements = scopeStatements(ancestor);
    if (statements !== null) visible = extendTypeEnvironment(visible, statements);
    if ("typeParameters" in ancestor) {
      for (const parameter of ancestor.typeParameters?.params ?? []) {
        visible = withoutVisibleTypeName(visible, parameter.name.name);
      }
    }
  }

  for (const name of lexicalStructuralTypeParameterNames(node, visitorKeys)) {
    visible = withoutVisibleTypeName(visible, name);
  }
  return visible;
}

/** Return an environment where one lexical type binding shadows declarations and imports. */
export function withoutVisibleTypeName(
  environment: PortableTypeEnvironment,
  name: string,
): PortableTypeEnvironment {
  const aliases = new Map(environment.aliases);
  const classes = new Map(environment.classes);
  const interfaces = new Map(environment.interfaces);
  const namespaces = new Map(environment.namespaces);
  const importedTypeNames = new Set(environment.importedTypeNames);
  const shadowedBuiltIns = new Set(environment.shadowedBuiltIns);
  shadowTypeName(name, {
    aliases,
    classes,
    importedTypeNames,
    interfaces,
    namespaces,
    shadowedBuiltIns,
  });
  return {
    aliases,
    classes,
    declaredTypeNames: new Set([...environment.declaredTypeNames, name]),
    importedTypeNames,
    interfaces,
    namespaces,
    shadowedBuiltIns,
    visitorKeys: environment.visitorKeys,
  };
}

export function typeReferenceName(type: PortableTSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

export function typeNameParts(typeName: PortableTSTypeName): readonly string[] {
  if (typeName.type === "Identifier") return [typeName.name];
  if (typeName.type === "ThisExpression") return [];
  return [...typeNameParts(typeName.left), typeName.right.name];
}

export function expressionTypeNameParts(expression: PortableNode): readonly string[] {
  if (expression.type === "Identifier") return [expression.name];
  if (
    expression.type !== "MemberExpression" ||
    expression.computed ||
    expression.property.type !== "Identifier"
  ) {
    return [];
  }
  const ownerParts = expressionTypeNameParts(expression.object);
  return ownerParts.length === 0 ? [] : [...ownerParts, expression.property.name];
}

export function isBuiltInType(name: string, environment: PortableTypeEnvironment): boolean {
  return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

export function unwrapTransparentType(type: PortableTSType): PortableTSType {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}

export function isUnappliedReferenceTo(type: PortableTSType, name: string): boolean {
  const unwrapped = unwrapTransparentType(type);
  return (
    unwrapped.type === "TSTypeReference" &&
    typeReferenceName(unwrapped) === name &&
    (unwrapped.typeArguments === null ||
      unwrapped.typeArguments === undefined ||
      unwrapped.typeArguments.params.length === 0)
  );
}

export function resolvedSubstitutionArgument(
  scopedType: PortableTypeArgument,
  resolving: ReadonlySet<string> = new Set(),
): PortableTypeArgument {
  const unwrapped = unwrapTransparentType(scopedType.type);
  if (unwrapped.type !== "TSTypeReference") return scopedType;
  const name = typeReferenceName(unwrapped);
  if (name === null || resolving.has(name)) return scopedType;
  const substitution = scopedType.substitutions.get(name);
  if (substitution === undefined) return scopedType;
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  return resolvedSubstitutionArgument(substitution, nextResolving);
}

export function typeParameterSubstitution(
  parameters: NonNullable<PortableTSTypeAliasDeclaration["typeParameters"]>["params"],
  arguments_: readonly PortableTypeArgument[],
  defaultEnvironment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): TypeSubstitutions | null {
  const next = new Map<string, PortableTypeArgument>();
  for (const [index, parameter] of parameters.entries()) {
    const suppliedArgument = arguments_[index];
    const defaultArgument = parameter.default;
    let argument: PortableTypeArgument;
    if (suppliedArgument !== undefined) {
      argument = suppliedArgument;
    } else {
      if (defaultArgument === null || defaultArgument === undefined) return null;
      argument = {
        environment: defaultEnvironment,
        resolveImportedType,
        substitutions: new Map(next),
        type: defaultArgument,
      };
    }
    next.set(parameter.name.name, resolvedSubstitutionArgument(argument));
  }
  return next;
}

export function aliasSubstitution(
  alias: PortableTSTypeAliasDeclaration,
  arguments_: readonly PortableTypeArgument[],
  defaultEnvironment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): TypeSubstitutions | null {
  return typeParameterSubstitution(
    alias.typeParameters?.params ?? [],
    arguments_,
    defaultEnvironment,
    resolveImportedType,
  );
}

export function scopedTypeArguments(
  type: PortableTSTypeReference,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions = new Map(),
  resolveImportedType?: PortableTypeResolver,
): readonly PortableTypeArgument[] {
  return (type.typeArguments?.params ?? []).map((argument) =>
    resolvedSubstitutionArgument({
      environment,
      resolveImportedType,
      substitutions,
      type: argument,
    }),
  );
}

function namespaceEnvironments(
  name: string,
  environment: PortableTypeEnvironment,
): readonly PortableTypeEnvironment[] {
  return (environment.namespaces.get(name) ?? []).flatMap((module) =>
    module.body?.type === "TSModuleBlock"
      ? [extendTypeEnvironment(environment, module.body.body)]
      : [],
  );
}

export function referencedTypeScopes(
  parts: readonly string[],
  environment: PortableTypeEnvironment,
): readonly { readonly environment: PortableTypeEnvironment; readonly name: string }[] {
  let environments: readonly PortableTypeEnvironment[] = [environment];
  for (const namespaceName of parts.slice(0, -1)) {
    environments = environments.flatMap((candidate) =>
      namespaceEnvironments(namespaceName, candidate),
    );
  }
  const name = parts.at(-1);
  return name === undefined
    ? []
    : environments.map((candidate) => ({ environment: candidate, name }));
}

/** Resolve local, namespaced, and imported declarations through one shared path. */
export function resolveNamedTypes(
  parts: readonly string[],
  arguments_: readonly PortableTypeArgument[],
  environment: PortableTypeEnvironment,
  resolveImportedType?: PortableTypeResolver,
): readonly ResolvedPortableType[] {
  const results: ResolvedPortableType[] = [];
  const key = localResolutionKey(environment, parts);
  for (const scope of referencedTypeScopes(parts, environment)) {
    const declarations = scope.environment.interfaces.get(scope.name);
    if (declarations !== undefined) {
      results.push({
        arguments: arguments_,
        declarations,
        environment: scope.environment,
        key,
        kind: "interface",
        name: scope.name,
        resolveImportedType,
      });
    }
    const alias = scope.environment.aliases.get(scope.name);
    if (alias !== undefined) {
      results.push({
        arguments: arguments_,
        declaration: alias,
        environment: scope.environment,
        key,
        kind: "alias",
        resolveImportedType,
      });
    }
  }
  const imported =
    parts[0] !== undefined && environment.importedTypeNames.has(parts[0])
      ? resolveImportedType?.(parts, arguments_)
      : undefined;
  if (imported !== null && imported !== undefined) results.push(imported);
  return results;
}

export function resolveTypeReference(
  type: PortableTSTypeReference,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
): readonly ResolvedPortableType[] {
  return resolveNamedTypes(
    typeNameParts(type.typeName),
    scopedTypeArguments(type, environment, substitutions, resolveImportedType),
    environment,
    resolveImportedType,
  );
}

export function resolveInterfaceHeritage(
  heritage: PortableTSInterfaceDeclaration["extends"][number],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
): readonly ResolvedPortableType[] {
  const parts = expressionTypeNameParts(heritage.expression);
  const arguments_ = (heritage.typeArguments?.params ?? []).map((argument) =>
    resolvedSubstitutionArgument({
      environment,
      resolveImportedType,
      substitutions,
      type: argument,
    }),
  );
  return resolveNamedTypes(parts, arguments_, environment, resolveImportedType);
}

/** Add a stable declaration and query key to a cycle trail. */
export function enterTypeResolution(
  resolving: ReadonlySet<string>,
  key: string,
  queryKey = "",
): ReadonlySet<string> | null {
  const resolutionKey = `${key}\0${queryKey}`;
  if (resolving.has(resolutionKey)) return null;
  const next = new Set(resolving);
  next.add(resolutionKey);
  return next;
}
