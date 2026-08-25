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
  "NonNullable",
  "Partial",
  "PropertyKey",
  "Readonly",
  "Record",
  "Required",
]);
const TRANSPARENT_WRAPPERS: ReadonlySet<string> = new Set([
  "Readonly",
  "Partial",
  "Required",
  "NonNullable",
]);

export type WideningTargetKind = "anonymous object" | "object" | "open dictionary" | "unknown";

export type WideningTarget = {
  readonly kind: WideningTargetKind;
};

export type WideningTypeEnvironment = {
  readonly aliases: ReadonlyMap<string, PortableTSTypeAliasDeclaration>;
  readonly interfaces: ReadonlyMap<string, readonly PortableTSInterfaceDeclaration[]>;
  readonly namespaces: ReadonlyMap<string, readonly PortableTSModuleDeclaration[]>;
  readonly shadowedBuiltIns: ReadonlySet<string>;
};

type ScopedType = {
  readonly environment: WideningTypeEnvironment;
  readonly type: PortableTSType;
};

export type WideningTypeArgument = ScopedType;

export type ResolvedWideningType =
  | {
      readonly arguments: readonly WideningTypeArgument[];
      readonly declaration: PortableTSTypeAliasDeclaration;
      readonly environment: WideningTypeEnvironment;
      readonly key: string;
      readonly kind: "alias";
      readonly resolveImportedType: WideningTypeResolver;
    }
  | {
      readonly arguments: readonly WideningTypeArgument[];
      readonly declarations: readonly PortableTSInterfaceDeclaration[];
      readonly environment: WideningTypeEnvironment;
      readonly key: string;
      readonly kind: "interface";
      readonly name: string;
      readonly resolveImportedType: WideningTypeResolver;
    };

export type WideningTypeResolver = (
  typeNameParts: readonly string[],
  arguments_: readonly WideningTypeArgument[],
) => ResolvedWideningType | null;

type TypeAliasEnvironment = ReadonlyMap<string, ScopedType>;

type WideningClassificationMode = "annotation" | "alias";

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

/** Build the top-level type declarations needed to classify a parsed module. */
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

function typeReferenceName(type: PortableTSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function typeNameParts(typeName: PortableTSTypeName): readonly string[] {
  if (typeName.type === "Identifier") return [typeName.name];
  if (typeName.type === "ThisExpression") return [];
  return [...typeNameParts(typeName.left), typeName.right.name];
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

function referencedTypeScopes(
  typeName: PortableTSTypeName,
  environment: WideningTypeEnvironment,
): readonly { readonly environment: WideningTypeEnvironment; readonly name: string }[] {
  return referencedTypePartScopes(typeNameParts(typeName), environment);
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

function isBuiltIn(name: string, environment: WideningTypeEnvironment): boolean {
  return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

function unwrapTransparentType(type: PortableTSType): PortableTSType {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}

function isUnappliedReferenceTo(type: PortableTSType, name: string): boolean {
  const unwrapped = unwrapTransparentType(type);
  return (
    unwrapped.type === "TSTypeReference" &&
    typeReferenceName(unwrapped) === name &&
    (unwrapped.typeArguments === null ||
      unwrapped.typeArguments === undefined ||
      unwrapped.typeArguments.params.length === 0)
  );
}

function resolvedSubstitutionArgument(
  scopedType: ScopedType,
  base: TypeAliasEnvironment,
  resolving: ReadonlySet<string> = new Set(),
): ScopedType {
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

function typeParameterSubstitution(
  parameters: NonNullable<PortableTSTypeAliasDeclaration["typeParameters"]>["params"],
  arguments_: readonly WideningTypeArgument[],
  defaultEnvironment: WideningTypeEnvironment,
  base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
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

function aliasSubstitution(
  alias: PortableTSTypeAliasDeclaration,
  arguments_: readonly WideningTypeArgument[],
  defaultEnvironment: WideningTypeEnvironment,
  base: TypeAliasEnvironment,
): TypeAliasEnvironment | null {
  return typeParameterSubstitution(
    alias.typeParameters?.params ?? [],
    arguments_,
    defaultEnvironment,
    base,
  );
}

function scopedTypeArguments(
  type: PortableTSTypeReference,
  environment: WideningTypeEnvironment,
  substitutions: TypeAliasEnvironment = new Map(),
): readonly WideningTypeArgument[] {
  return (type.typeArguments?.params ?? []).map((argument) =>
    resolvedSubstitutionArgument({ environment, type: argument }, substitutions),
  );
}

function expressionTypeNameParts(expression: PortableNode): readonly string[] {
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

function interfaceWideningTarget(
  name: string,
  declarations: readonly PortableTSInterfaceDeclaration[],
  environment: WideningTypeEnvironment,
  arguments_: readonly WideningTypeArgument[] = [],
  resolveImportedType?: WideningTypeResolver,
  resolving: ReadonlySet<string> = new Set(),
): WideningTarget | null {
  if (resolving.has(name)) return null;
  const nextResolving = new Set(resolving);
  nextResolving.add(name);
  for (const interface_ of declarations) {
    const substitutions = typeParameterSubstitution(
      interface_.typeParameters?.params ?? [],
      arguments_,
      environment,
      new Map(),
    );
    if (substitutions === null) continue;
    if (interface_.body.body.some((member) => member.type === "TSIndexSignature")) {
      return { kind: "open dictionary" };
    }
    for (const heritage of interface_.extends) {
      const heritageParts = expressionTypeNameParts(heritage.expression);
      const heritageName = heritageParts.length === 1 ? heritageParts[0] : undefined;
      const heritageKey = heritageParts.join(".");
      const heritageArguments = (heritage.typeArguments?.params ?? []).map((argument) =>
        resolvedSubstitutionArgument({ environment, type: argument }, substitutions),
      );
      if (heritageName === "Record" && isBuiltIn(heritageName, environment)) {
        const key = heritage.typeArguments?.params[0];
        if (
          key !== undefined &&
          isBroadMappedKey(key, environment, substitutions, nextResolving, resolveImportedType)
        ) {
          return { kind: "open dictionary" };
        }
        continue;
      }
      if (
        heritageName !== undefined &&
        TRANSPARENT_WRAPPERS.has(heritageName) &&
        isBuiltIn(heritageName, environment)
      ) {
        const wrapped = heritage.typeArguments?.params[0];
        const target =
          wrapped === undefined
            ? null
            : classifyWideningTargetWithState(
                wrapped,
                environment,
                substitutions,
                nextResolving,
                "alias",
                resolveImportedType,
              );
        if (target !== null) return target;
      }
      for (const scope of referencedTypePartScopes(heritageParts, environment)) {
        const inheritedInterfaces = scope.environment.interfaces.get(scope.name);
        if (inheritedInterfaces !== undefined) {
          const target = interfaceWideningTarget(
            heritageKey,
            inheritedInterfaces,
            scope.environment,
            heritageArguments,
            resolveImportedType,
            nextResolving,
          );
          if (target !== null) return target;
        }
        const heritageAlias = scope.environment.aliases.get(scope.name);
        if (heritageAlias !== undefined) {
          const aliasSubstitutions = aliasSubstitution(
            heritageAlias,
            heritageArguments,
            scope.environment,
            substitutions,
          );
          if (aliasSubstitutions === null) continue;
          const target = classifyWideningTargetWithState(
            heritageAlias.typeAnnotation,
            scope.environment,
            aliasSubstitutions,
            new Set([...nextResolving, heritageKey]),
            "alias",
            resolveImportedType,
          );
          if (target !== null) return target;
        }
      }
      const importedType = resolveImportedType?.(heritageParts, heritageArguments);
      if (importedType !== null && importedType !== undefined) {
        const target = classifyResolvedWideningType(importedType, nextResolving);
        if (target !== null) return target;
      }
    }
  }
  return null;
}

function classifyResolvedWideningType(
  resolved: ResolvedWideningType,
  resolvingAliases: ReadonlySet<string>,
): WideningTarget | null {
  if (resolvingAliases.has(resolved.key)) return null;
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(resolved.key);
  if (resolved.kind === "interface") {
    return interfaceWideningTarget(
      resolved.name,
      resolved.declarations,
      resolved.environment,
      resolved.arguments,
      resolved.resolveImportedType,
      nextResolving,
    );
  }
  const substitutions = aliasSubstitution(
    resolved.declaration,
    resolved.arguments,
    resolved.environment,
    new Map(),
  );
  return substitutions === null
    ? null
    : classifyWideningTargetWithState(
        resolved.declaration.typeAnnotation,
        resolved.environment,
        substitutions,
        nextResolving,
        "alias",
        resolved.resolveImportedType,
      );
}

/** Classify a target type that discards known structural evidence. */
export function classifyWideningTarget(
  type: PortableTSType,
  environment: WideningTypeEnvironment,
  resolveImportedType?: WideningTypeResolver,
): WideningTarget | null {
  return classifyWideningTargetWithState(
    type,
    environment,
    new Map(),
    new Set(),
    "annotation",
    resolveImportedType,
  );
}

/** Classify a named interface through its declarations and heritage. */
export function classifyNamedInterfaceWideningTarget(
  name: string,
  environment: WideningTypeEnvironment,
  arguments_: readonly WideningTypeArgument[] = [],
  resolveImportedType?: WideningTypeResolver,
): WideningTarget | null {
  const declarations = environment.interfaces.get(name);
  return declarations === undefined
    ? null
    : interfaceWideningTarget(name, declarations, environment, arguments_, resolveImportedType);
}

/** Classify a named alias without treating a closed object alias as anonymous. */
export function classifyNamedAliasWideningTarget(
  name: string,
  environment: WideningTypeEnvironment,
  arguments_: readonly WideningTypeArgument[] = [],
  resolveImportedType?: WideningTypeResolver,
): WideningTarget | null {
  const alias = environment.aliases.get(name);
  if (alias === undefined) return null;
  const substitutions = aliasSubstitution(alias, arguments_, environment, new Map());
  return substitutions === null
    ? null
    : classifyWideningTargetWithState(
        alias.typeAnnotation,
        environment,
        substitutions,
        new Set([name]),
        "alias",
        resolveImportedType,
      );
}

function classifyWideningTargetWithState(
  type: PortableTSType,
  environment: WideningTypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string>,
  mode: WideningClassificationMode,
  resolveImportedType?: WideningTypeResolver,
): WideningTarget | null {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSUnknownKeyword") return { kind: "unknown" };
  if (unwrapped.type === "TSObjectKeyword") return { kind: "object" };
  if (unwrapped.type === "TSUnionType") {
    for (const member of unwrapped.types) {
      const target = classifyWideningTargetWithState(
        member,
        environment,
        substitutions,
        resolvingAliases,
        mode,
        resolveImportedType,
      );
      if (target !== null) return target;
    }
    return null;
  }
  if (unwrapped.type === "TSTypeLiteral") {
    return unwrapped.members.some((member) => member.type === "TSIndexSignature")
      ? { kind: "open dictionary" }
      : mode === "annotation" && unwrapped.members.length > 0
        ? { kind: "anonymous object" }
        : null;
  }
  if (unwrapped.type === "TSMappedType") {
    return mode === "annotation" ||
      isBroadMappedKey(
        unwrapped.constraint,
        environment,
        substitutions,
        resolvingAliases,
        resolveImportedType,
      )
      ? { kind: "open dictionary" }
      : null;
  }
  if (unwrapped.type !== "TSTypeReference") return null;
  const simpleName = typeReferenceName(unwrapped);
  if (simpleName !== null) {
    const substitution = substitutions.get(simpleName);
    if (substitution !== undefined) {
      return isUnappliedReferenceTo(substitution.type, simpleName)
        ? null
        : classifyWideningTargetWithState(
            substitution.type,
            substitution.environment,
            substitutions,
            resolvingAliases,
            mode,
            resolveImportedType,
          );
    }
  }
  if (
    simpleName !== null &&
    TRANSPARENT_WRAPPERS.has(simpleName) &&
    isBuiltIn(simpleName, environment)
  ) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined
      ? null
      : classifyWideningTargetWithState(
          wrapped,
          environment,
          substitutions,
          resolvingAliases,
          mode,
          resolveImportedType,
        );
  }
  if (simpleName === "Record" && isBuiltIn(simpleName, environment)) {
    const key = unwrapped.typeArguments?.params[0];
    return key !== undefined &&
      isBroadMappedKey(key, environment, substitutions, resolvingAliases, resolveImportedType)
      ? { kind: "open dictionary" }
      : null;
  }
  const referenceKey = typeNameParts(unwrapped.typeName).join(".");
  if (resolvingAliases.has(referenceKey)) return null;
  for (const scope of referencedTypeScopes(unwrapped.typeName, environment)) {
    const interfaceDeclarations = scope.environment.interfaces.get(scope.name);
    if (interfaceDeclarations !== undefined) {
      const target = interfaceWideningTarget(
        scope.name,
        interfaceDeclarations,
        scope.environment,
        scopedTypeArguments(unwrapped, environment, substitutions),
        resolveImportedType,
      );
      if (target !== null) return target;
    }
    const alias = scope.environment.aliases.get(scope.name);
    if (alias === undefined) continue;
    const nextSubstitutions = aliasSubstitution(
      alias,
      scopedTypeArguments(unwrapped, environment, substitutions),
      scope.environment,
      substitutions,
    );
    if (nextSubstitutions === null) continue;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(referenceKey);
    const target = classifyWideningTargetWithState(
      alias.typeAnnotation,
      scope.environment,
      nextSubstitutions,
      nextResolving,
      "alias",
      resolveImportedType,
    );
    if (target !== null) return target;
  }
  const importedType = resolveImportedType?.(
    typeNameParts(unwrapped.typeName),
    scopedTypeArguments(unwrapped, environment, substitutions),
  );
  return importedType === null || importedType === undefined
    ? null
    : classifyResolvedWideningType(importedType, resolvingAliases);
}

function isBroadMappedKey(
  type: PortableTSType,
  environment: WideningTypeEnvironment,
  substitutions: TypeAliasEnvironment,
  resolvingAliases: ReadonlySet<string> = new Set(),
  resolveImportedType?: WideningTypeResolver,
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
      isBroadMappedKey(member, environment, substitutions, resolvingAliases, resolveImportedType),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return false;
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return isBroadMappedKey(
        substitution.type,
        substitution.environment,
        substitutions,
        resolvingAliases,
        resolveImportedType,
      );
    }
    if (name === "PropertyKey" && isBuiltIn(name, environment)) return true;
  }
  const referenceKey = typeNameParts(unwrapped.typeName).join(".");
  if (resolvingAliases.has(referenceKey)) return false;
  for (const scope of referencedTypeScopes(unwrapped.typeName, environment)) {
    const alias = scope.environment.aliases.get(scope.name);
    if (alias === undefined) continue;
    const nextSubstitutions = aliasSubstitution(
      alias,
      scopedTypeArguments(unwrapped, environment, substitutions),
      scope.environment,
      substitutions,
    );
    if (nextSubstitutions === null) continue;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(referenceKey);
    if (
      isBroadMappedKey(
        alias.typeAnnotation,
        scope.environment,
        nextSubstitutions,
        nextResolving,
        resolveImportedType,
      )
    ) {
      return true;
    }
  }
  const importedType = resolveImportedType?.(
    typeNameParts(unwrapped.typeName),
    scopedTypeArguments(unwrapped, environment, substitutions),
  );
  if (importedType?.kind !== "alias" || resolvingAliases.has(importedType.key)) return false;
  const importedSubstitutions = aliasSubstitution(
    importedType.declaration,
    importedType.arguments,
    importedType.environment,
    new Map(),
  );
  if (importedSubstitutions === null) return false;
  const nextResolving = new Set(resolvingAliases);
  nextResolving.add(importedType.key);
  return isBroadMappedKey(
    importedType.declaration.typeAnnotation,
    importedType.environment,
    importedSubstitutions,
    nextResolving,
    importedType.resolveImportedType,
  );
}
