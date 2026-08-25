import type {
  PortableModuleItem,
  PortableNode,
  PortableTSInterfaceDeclaration,
  PortableTSModuleDeclaration,
  PortableTSType,
  PortableTSTypeAliasDeclaration,
  PortableTSTypeName,
  PortableTSTypeReference,
} from "./portable-ast.ts";

const BUILT_INS = new Set([
  "Array",
  "NonNullable",
  "Partial",
  "Pick",
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

export type WideningTypeEnvironment = {
  readonly aliases: ReadonlyMap<string, PortableTSTypeAliasDeclaration>;
  readonly interfaces: ReadonlyMap<string, readonly PortableTSInterfaceDeclaration[]>;
  readonly namespaces: ReadonlyMap<string, readonly PortableTSModuleDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
};

export type WideningTypeArgument = {
  readonly environment: WideningTypeEnvironment;
  readonly type: PortableTSType;
};

export type ResolvedWideningType =
  | {
      readonly arguments: readonly WideningTypeArgument[];
      readonly declaration: PortableTSTypeAliasDeclaration;
      readonly environment: WideningTypeEnvironment;
      readonly key: string;
      readonly kind: "alias";
      readonly resolveImportedType: WideningTypeResolver | undefined;
    }
  | {
      readonly arguments: readonly WideningTypeArgument[];
      readonly declarations: readonly PortableTSInterfaceDeclaration[];
      readonly environment: WideningTypeEnvironment;
      readonly key: string;
      readonly kind: "interface";
      readonly name: string;
      readonly resolveImportedType: WideningTypeResolver | undefined;
    };

export type WideningTypeResolver = (
  typeNameParts: readonly string[],
  arguments_: readonly WideningTypeArgument[],
) => ResolvedWideningType | null;

export type TypeSubstitutions = ReadonlyMap<string, WideningTypeArgument>;

const environmentIds = new WeakMap<WideningTypeEnvironment, number>();
let nextEnvironmentId = 1;

function environmentId(environment: WideningTypeEnvironment): number {
  const existing = environmentIds.get(environment);
  if (existing !== undefined) return existing;
  const id = nextEnvironmentId;
  nextEnvironmentId += 1;
  environmentIds.set(environment, id);
  return id;
}

function localResolutionKey(
  environment: WideningTypeEnvironment,
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
export function createWideningModuleEnvironment(
  statements: readonly PortableModuleItem[],
): WideningTypeEnvironment {
  const aliases = new Map<string, PortableTSTypeAliasDeclaration>();
  const interfaces = new Map<string, PortableTSInterfaceDeclaration[]>();
  const namespaces = new Map<string, PortableTSModuleDeclaration[]>();
  const typeNames = new Set<string>();
  const competingInterfaceNames = new Set<string>();

  for (const statement of statements) {
    const node = declaration(statement);
    if (node?.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) {
        typeNames.add(specifier.local.name);
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
    competingInterfaceNames.add(name);
  }

  for (const name of competingInterfaceNames) interfaces.delete(name);
  return {
    aliases,
    interfaces,
    namespaces,
    shadowedBuiltIns: new Set([...typeNames].filter((name) => BUILT_INS.has(name))),
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

export function isBuiltInType(name: string, environment: WideningTypeEnvironment): boolean {
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
  scopedType: WideningTypeArgument,
  base: TypeSubstitutions,
  resolving: ReadonlySet<string> = new Set(),
): WideningTypeArgument {
  const unwrapped = unwrapTransparentType(scopedType.type);
  if (unwrapped.type !== "TSTypeReference") return scopedType;
  const name = typeReferenceName(unwrapped);
  if (name === null || resolving.has(name)) return scopedType;
  const substitution = base.get(name);
  if (substitution === undefined) return scopedType;
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  return resolvedSubstitutionArgument(substitution, base, nextResolving);
}

export function typeParameterSubstitution(
  parameters: NonNullable<PortableTSTypeAliasDeclaration["typeParameters"]>["params"],
  arguments_: readonly WideningTypeArgument[],
  defaultEnvironment: WideningTypeEnvironment,
  base: TypeSubstitutions,
): TypeSubstitutions | null {
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const suppliedArgument = arguments_[index];
    const defaultArgument = parameter.default;
    let argument: WideningTypeArgument;
    if (suppliedArgument !== undefined) {
      argument = suppliedArgument;
    } else {
      if (defaultArgument === null || defaultArgument === undefined) return null;
      argument = { type: defaultArgument, environment: defaultEnvironment };
    }
    next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
  }
  return next;
}

export function aliasSubstitution(
  alias: PortableTSTypeAliasDeclaration,
  arguments_: readonly WideningTypeArgument[],
  defaultEnvironment: WideningTypeEnvironment,
  base: TypeSubstitutions,
): TypeSubstitutions | null {
  return typeParameterSubstitution(
    alias.typeParameters?.params ?? [],
    arguments_,
    defaultEnvironment,
    base,
  );
}

export function scopedTypeArguments(
  type: PortableTSTypeReference,
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions = new Map(),
): readonly WideningTypeArgument[] {
  return (type.typeArguments?.params ?? []).map((argument) =>
    resolvedSubstitutionArgument({ environment, type: argument }, substitutions),
  );
}

function namespaceEnvironments(
  name: string,
  environment: WideningTypeEnvironment,
): readonly WideningTypeEnvironment[] {
  return (environment.namespaces.get(name) ?? []).flatMap((module) =>
    module.body?.type === "TSModuleBlock"
      ? [createWideningModuleEnvironment(module.body.body)]
      : [],
  );
}

function referencedTypePartScopes(
  parts: readonly string[],
  environment: WideningTypeEnvironment,
): readonly { readonly environment: WideningTypeEnvironment; readonly name: string }[] {
  let environments: readonly WideningTypeEnvironment[] = [environment];
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
  arguments_: readonly WideningTypeArgument[],
  environment: WideningTypeEnvironment,
  resolveImportedType?: WideningTypeResolver,
): readonly ResolvedWideningType[] {
  const results: ResolvedWideningType[] = [];
  const key = localResolutionKey(environment, parts);
  for (const scope of referencedTypePartScopes(parts, environment)) {
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
  const imported = resolveImportedType?.(parts, arguments_);
  if (imported !== null && imported !== undefined) results.push(imported);
  return results;
}

export function resolveTypeReference(
  type: PortableTSTypeReference,
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: WideningTypeResolver,
): readonly ResolvedWideningType[] {
  return resolveNamedTypes(
    typeNameParts(type.typeName),
    scopedTypeArguments(type, environment, substitutions),
    environment,
    resolveImportedType,
  );
}

export function resolveInterfaceHeritage(
  heritage: PortableTSInterfaceDeclaration["extends"][number],
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: WideningTypeResolver,
): readonly ResolvedWideningType[] {
  const parts = expressionTypeNameParts(heritage.expression);
  const arguments_ = (heritage.typeArguments?.params ?? []).map((argument) =>
    resolvedSubstitutionArgument({ environment, type: argument }, substitutions),
  );
  return resolveNamedTypes(parts, arguments_, environment, resolveImportedType);
}

/** Return whether a mapped/index key accepts an arbitrary property key. */
export function isBroadPropertyKey(
  type: PortableTSType,
  environment: WideningTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: WideningTypeResolver,
  resolving: ReadonlySet<string> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentType(type);
  if (
    unwrapped.type === "TSStringKeyword" ||
    unwrapped.type === "TSNumberKeyword" ||
    unwrapped.type === "TSSymbolKeyword"
  ) {
    return true;
  }
  if (unwrapped.type === "TSUnionType") {
    return unwrapped.types.some((member) =>
      isBroadPropertyKey(member, environment, substitutions, resolveImportedType, resolving),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return isBroadPropertyKey(
        substitution.type,
        substitution.environment,
        substitutions,
        resolveImportedType,
        resolving,
      );
    }
    if (name === "PropertyKey" && isBuiltInType(name, environment)) return true;
  }
  for (const resolved of resolveTypeReference(
    unwrapped,
    environment,
    substitutions,
    resolveImportedType,
  )) {
    if (resolved.kind !== "alias") continue;
    const nextResolving = enterTypeResolution(resolving, resolved.key, "property-key");
    if (nextResolving === null) continue;
    const aliasSubstitutions = aliasSubstitution(
      resolved.declaration,
      resolved.arguments,
      resolved.environment,
      substitutions,
    );
    if (
      aliasSubstitutions !== null &&
      isBroadPropertyKey(
        resolved.declaration.typeAnnotation,
        resolved.environment,
        aliasSubstitutions,
        resolved.resolveImportedType,
        nextResolving,
      )
    ) {
      return true;
    }
  }
  return false;
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
