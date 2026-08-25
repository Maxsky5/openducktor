import type { PortableTSInterfaceDeclaration, PortableTSType } from "./portable-ast.ts";
import {
  aliasSubstitution,
  enterTypeResolution,
  expressionTypeNameParts,
  isBroadPropertyKey,
  isBuiltInType,
  isUnappliedReferenceTo,
  resolveInterfaceHeritage,
  resolveTypeReference,
  TRANSPARENT_TYPE_WRAPPERS,
  typeParameterSubstitution,
  typeReferenceName,
  unwrapTransparentType,
  type ResolvedWideningType,
  type TypeSubstitutions,
  type WideningTypeArgument,
  type WideningTypeEnvironment,
  type WideningTypeResolver,
} from "./portable-type-resolution.ts";

export {
  createWideningModuleEnvironment,
  type ResolvedWideningType,
  type WideningTypeArgument,
  type WideningTypeEnvironment,
  type WideningTypeResolver,
} from "./portable-type-resolution.ts";

export type WideningTargetKind = "anonymous object" | "object" | "open dictionary" | "unknown";

export type WideningTarget = {
  readonly kind: WideningTargetKind;
};

type WideningClassificationMode = "annotation" | "alias";

function interfaceWideningTarget(
  declarations: readonly PortableTSInterfaceDeclaration[],
  environment: WideningTypeEnvironment,
  arguments_: readonly WideningTypeArgument[] = [],
  resolveImportedType?: WideningTypeResolver,
  resolving: ReadonlySet<string> = new Set(),
): WideningTarget | null {
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
      if (heritageName === "Record" && isBuiltInType(heritageName, environment)) {
        const key = heritage.typeArguments?.params[0];
        if (
          key !== undefined &&
          isBroadPropertyKey(key, environment, substitutions, resolveImportedType, resolving)
        ) {
          return { kind: "open dictionary" };
        }
        continue;
      }
      if (
        heritageName !== undefined &&
        TRANSPARENT_TYPE_WRAPPERS.has(heritageName) &&
        isBuiltInType(heritageName, environment)
      ) {
        const wrapped = heritage.typeArguments?.params[0];
        const target =
          wrapped === undefined
            ? null
            : classifyWideningTargetWithState(
                wrapped,
                environment,
                substitutions,
                resolving,
                "alias",
                resolveImportedType,
              );
        if (target !== null) return target;
      }
      for (const resolved of resolveInterfaceHeritage(
        heritage,
        environment,
        substitutions,
        resolveImportedType,
      )) {
        const target = classifyResolvedWideningType(resolved, resolving);
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
  const nextResolving = enterTypeResolution(resolvingAliases, resolved.key, "widening");
  if (nextResolving === null) return null;
  if (resolved.kind === "interface") {
    return interfaceWideningTarget(
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
    : classifyResolvedWideningType(
        {
          arguments: arguments_,
          declarations,
          environment,
          key: `named-interface\0${name}`,
          kind: "interface",
          name,
          resolveImportedType,
        },
        new Set(),
      );
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
  substitutions: TypeSubstitutions,
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
      isBroadPropertyKey(
        unwrapped.constraint,
        environment,
        substitutions,
        resolveImportedType,
        resolvingAliases,
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
    TRANSPARENT_TYPE_WRAPPERS.has(simpleName) &&
    isBuiltInType(simpleName, environment)
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
  if (simpleName === "Record" && isBuiltInType(simpleName, environment)) {
    const key = unwrapped.typeArguments?.params[0];
    return key !== undefined &&
      isBroadPropertyKey(key, environment, substitutions, resolveImportedType, resolvingAliases)
      ? { kind: "open dictionary" }
      : null;
  }
  for (const resolved of resolveTypeReference(
    unwrapped,
    environment,
    substitutions,
    resolveImportedType,
  )) {
    const target = classifyResolvedWideningType(resolved, resolvingAliases);
    if (target !== null) return target;
  }
  return null;
}
