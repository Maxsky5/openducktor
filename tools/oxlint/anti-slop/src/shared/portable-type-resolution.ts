import type {
  PortableTSInterfaceDeclaration,
  PortableTSTypeAliasDeclaration,
  PortableTSTypeReference,
} from "./portable-ast.ts";
import { extendPortableTypeEnvironment } from "./portable-type-declarations.ts";
import {
  expressionTypeNameParts,
  localResolutionKey,
  typeNameParts,
  typeReferenceName,
  unwrapTransparentType,
  type PortableTypeArgument,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type PortableValueBinding,
  type ResolvedPortableType,
  type TypeSubstitutions,
} from "./portable-type-model.ts";

export * from "./portable-type-model.ts";
export {
  createPortableModuleTypeEnvironment,
  extendPortableTypeEnvironment,
} from "./portable-type-declarations.ts";
export { createTypeEnvironment } from "./portable-lexical-environment.ts";
export { withoutVisibleTypeName } from "./portable-value-bindings.ts";

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
      ? [extendPortableTypeEnvironment(environment, module.body.body)]
      : [],
  );
}

export function resolveValueBindings(
  parts: readonly string[],
  environment: PortableTypeEnvironment,
): readonly {
  readonly binding: PortableValueBinding;
  readonly environment: PortableTypeEnvironment;
}[] {
  let environments: readonly PortableTypeEnvironment[] = [environment];
  for (const namespaceName of parts.slice(0, -1)) {
    environments = environments.flatMap((candidate) =>
      namespaceEnvironments(namespaceName, candidate),
    );
  }
  const name = parts.at(-1);
  return name === undefined
    ? []
    : environments.flatMap((candidate) => {
        const binding = candidate.valueBindings.get(name);
        return binding === undefined ? [] : [{ binding, environment: candidate }];
      });
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
      ? resolveImportedType?.resolveType(parts, arguments_)
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
