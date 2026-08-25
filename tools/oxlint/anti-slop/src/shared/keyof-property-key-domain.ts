import type { ESTree } from "@oxlint/plugins";

import type {
  PortableNode,
  PortableTSInterfaceDeclaration,
  PortableTSType,
} from "./portable-ast.ts";
import {
  emptyPropertyKeyDomain,
  intersectPropertyKeyDomains,
  propertyKeyDomainAtomicDomains,
  propertyKeyDomainIncludes,
  propertyKeyDomainValueId,
  subtractPropertyKeyDomains,
  unionPropertyKeyDomains,
  type PropertyKeyDomain,
  type PropertyKeyResolutionContext,
} from "./property-key-domain-model.ts";
import {
  aliasSubstitution,
  enterTypeResolution,
  expressionTypeNameParts,
  isBuiltInType,
  isUnappliedReferenceTo,
  resolveInterfaceHeritage,
  resolveTypeReference,
  TRANSPARENT_TYPE_WRAPPERS,
  typeParameterSubstitution,
  typeReferenceName,
  unwrapTransparentType,
  type PortableTypeArgument,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type ResolvedPortableType,
  type TypeSubstitutions,
} from "./portable-type-resolution.ts";
import { resolveUniqueSymbolReferenceDomain } from "./unique-symbol-property-key-domain.ts";

type PropertyKeyDomainResolver = (
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
  resolving?: ReadonlySet<string>,
  keyDomainSubstitutions?: ReadonlyMap<string, PropertyKeyDomain>,
) => PropertyKeyDomain;

type MappedPropertyKeyMapping = {
  readonly exposed: PropertyKeyDomain;
  readonly source: PropertyKeyDomain;
};

function mappedPropertyKeyMappings(
  type: Extract<PortableTSType, { type: "TSMappedType" }>,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): readonly MappedPropertyKeyMapping[] {
  const sourceDomain = resolvePropertyKeyDomain(
    type.constraint,
    environment,
    substitutions,
    resolveImportedType,
    context.resolving,
    context.keyDomainSubstitutions,
  );
  const nameType = type.nameType;
  return propertyKeyDomainAtomicDomains(sourceDomain).map((source) => ({
    exposed:
      nameType === null
        ? source
        : resolvePropertyKeyDomain(
            nameType,
            environment,
            substitutions,
            resolveImportedType,
            context.resolving,
            new Map(context.keyDomainSubstitutions).set(type.key.name, source),
          ),
    source,
  }));
}

export function resolveMappedPropertyKeyDomain(
  type: Extract<PortableTSType, { type: "TSMappedType" }>,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  return unionPropertyKeyDomains(
    mappedPropertyKeyMappings(
      type,
      environment,
      substitutions,
      resolveImportedType,
      context,
      resolvePropertyKeyDomain,
    ).map(({ exposed }) => exposed),
  );
}

export function resolveMappedSourceKeyDomains(
  type: Extract<PortableTSType, { type: "TSMappedType" }>,
  exposedKey: PropertyKeyDomain,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): readonly PropertyKeyDomain[] {
  if (type.nameType === null) {
    const sourceDomain = resolvePropertyKeyDomain(
      type.constraint,
      environment,
      substitutions,
      resolveImportedType,
      context.resolving,
      context.keyDomainSubstitutions,
    );
    return propertyKeyDomainIncludes(sourceDomain, exposedKey) ? [exposedKey] : [];
  }
  return mappedPropertyKeyMappings(
    type,
    environment,
    substitutions,
    resolveImportedType,
    context,
    resolvePropertyKeyDomain,
  )
    .filter(({ exposed }) => propertyKeyDomainIncludes(exposed, exposedKey))
    .map(({ source }) => source);
}

/** Return a statically known property key from an ESTree-compatible node. */
export function portablePropertyKeyValue(key: PortableNode | ESTree.Node): number | string | null {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) {
    return key.value;
  }
  if (
    key.type === "UnaryExpression" &&
    (key.operator === "+" || key.operator === "-") &&
    key.argument.type === "Literal" &&
    typeof key.argument.value === "number"
  ) {
    return key.operator === "-" ? -key.argument.value : key.argument.value;
  }
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? key.quasis[0]?.value.raw ?? null;
  }
  return null;
}

function memberPropertyKeyDomain(
  member: PortableNode,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  if (member.type === "TSIndexSignature") {
    const keyType = member.parameters[0]?.typeAnnotation.typeAnnotation;
    if (keyType === undefined) return emptyPropertyKeyDomain();
    const domain = resolvePropertyKeyDomain(
      keyType,
      environment,
      substitutions,
      resolveImportedType,
      context.resolving,
      context.keyDomainSubstitutions,
    );
    return domain.strings ? { ...domain, numbers: true } : domain;
  }
  if (member.type !== "TSPropertySignature" && member.type !== "TSMethodSignature") {
    return emptyPropertyKeyDomain();
  }
  if (member.computed) {
    const domain = resolveUniqueSymbolReferenceDomain(
      { kind: "name", parts: expressionTypeNameParts(member.key) },
      environment,
      resolveImportedType,
    );
    if (domain.uniqueSymbols.size > 0) return domain;
  }
  const value = portablePropertyKeyValue(member.key);
  return value === null
    ? emptyPropertyKeyDomain()
    : { ...emptyPropertyKeyDomain(), values: new Set([propertyKeyDomainValueId(value)]) };
}

function membersPropertyKeyDomain(
  members: readonly PortableNode[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  return unionPropertyKeyDomains(
    members.map((member) =>
      memberPropertyKeyDomain(
        member,
        environment,
        substitutions,
        resolveImportedType,
        context,
        resolvePropertyKeyDomain,
      ),
    ),
  );
}

function interfacePropertyKeyDomain(
  declarations: readonly PortableTSInterfaceDeclaration[],
  environment: PortableTypeEnvironment,
  arguments_: readonly PortableTypeArgument[],
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  const domains: PropertyKeyDomain[] = [];
  for (const declaration of declarations) {
    const substitutions = typeParameterSubstitution(
      declaration.typeParameters?.params ?? [],
      arguments_,
      environment,
      resolveImportedType,
    );
    if (substitutions === null) continue;
    domains.push(
      membersPropertyKeyDomain(
        declaration.body.body,
        environment,
        substitutions,
        resolveImportedType,
        context,
        resolvePropertyKeyDomain,
      ),
    );
    for (const heritage of declaration.extends) {
      const parts = expressionTypeNameParts(heritage.expression);
      const builtIn =
        parts.length === 1
          ? builtInObjectPropertyKeyDomain(
              parts[0] ?? "",
              heritage.typeArguments?.params ?? [],
              environment,
              substitutions,
              resolveImportedType,
              context,
              resolvePropertyKeyDomain,
            )
          : null;
      if (builtIn !== null) {
        domains.push(builtIn);
        continue;
      }
      for (const resolved of resolveInterfaceHeritage(
        heritage,
        environment,
        substitutions,
        resolveImportedType,
      )) {
        domains.push(resolvedObjectPropertyKeyDomain(resolved, context, resolvePropertyKeyDomain));
      }
    }
  }
  return unionPropertyKeyDomains(domains);
}

function resolvedObjectPropertyKeyDomain(
  resolved: ResolvedPortableType,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  const nextResolving = enterTypeResolution(
    context.resolving,
    resolved.key,
    "object-property-key-domain",
  );
  if (nextResolving === null) return emptyPropertyKeyDomain();
  const nextContext = { ...context, resolving: nextResolving };
  if (resolved.kind === "interface") {
    return interfacePropertyKeyDomain(
      resolved.declarations,
      resolved.environment,
      resolved.arguments,
      resolved.resolveImportedType,
      nextContext,
      resolvePropertyKeyDomain,
    );
  }
  const substitutions = aliasSubstitution(
    resolved.declaration,
    resolved.arguments,
    resolved.environment,
    resolved.resolveImportedType,
  );
  return substitutions === null
    ? emptyPropertyKeyDomain()
    : resolveObjectPropertyKeyDomain(
        resolved.declaration.typeAnnotation,
        resolved.environment,
        substitutions,
        resolved.resolveImportedType,
        nextContext,
        resolvePropertyKeyDomain,
      );
}

function builtInObjectPropertyKeyDomain(
  name: string,
  arguments_: readonly PortableTSType[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain | null {
  if (!isBuiltInType(name, environment)) return null;
  if (TRANSPARENT_TYPE_WRAPPERS.has(name)) {
    const wrapped = arguments_[0];
    return wrapped === undefined
      ? emptyPropertyKeyDomain()
      : resolveObjectPropertyKeyDomain(
          wrapped,
          environment,
          substitutions,
          resolveImportedType,
          context,
          resolvePropertyKeyDomain,
        );
  }
  if (name === "Record") {
    const key = arguments_[0];
    return key === undefined
      ? emptyPropertyKeyDomain()
      : resolvePropertyKeyDomain(
          key,
          environment,
          substitutions,
          resolveImportedType,
          context.resolving,
          context.keyDomainSubstitutions,
        );
  }
  if (name === "Array" || name === "ReadonlyArray") {
    return { ...emptyPropertyKeyDomain(), numbers: true };
  }
  if (name !== "Pick" && name !== "Omit") return null;
  const [source, selected] = arguments_;
  if (source === undefined || selected === undefined) return emptyPropertyKeyDomain();
  const sourceDomain = resolveObjectPropertyKeyDomain(
    source,
    environment,
    substitutions,
    resolveImportedType,
    context,
    resolvePropertyKeyDomain,
  );
  const selectedDomain = resolvePropertyKeyDomain(
    selected,
    environment,
    substitutions,
    resolveImportedType,
    context.resolving,
    context.keyDomainSubstitutions,
  );
  return name === "Pick"
    ? intersectPropertyKeyDomains(sourceDomain, selectedDomain)
    : subtractPropertyKeyDomains(sourceDomain, selectedDomain);
}

export function resolveObjectPropertyKeyDomain(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  context: PropertyKeyResolutionContext,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSAnyKeyword") {
    return { ...emptyPropertyKeyDomain(), numbers: true, strings: true, symbols: true };
  }
  if (unwrapped.type === "TSTypeLiteral") {
    return membersPropertyKeyDomain(
      unwrapped.members,
      environment,
      substitutions,
      resolveImportedType,
      context,
      resolvePropertyKeyDomain,
    );
  }
  if (unwrapped.type === "TSMappedType") {
    return resolveMappedPropertyKeyDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      context,
      resolvePropertyKeyDomain,
    );
  }
  if (unwrapped.type === "TSIntersectionType") {
    return unionPropertyKeyDomains(
      unwrapped.types.map((member) =>
        resolveObjectPropertyKeyDomain(
          member,
          environment,
          substitutions,
          resolveImportedType,
          context,
          resolvePropertyKeyDomain,
        ),
      ),
    );
  }
  if (unwrapped.type === "TSUnionType") {
    const [first, ...rest] = unwrapped.types;
    if (first === undefined) return emptyPropertyKeyDomain();
    return rest.reduce(
      (domain, member) =>
        intersectPropertyKeyDomains(
          domain,
          resolveObjectPropertyKeyDomain(
            member,
            environment,
            substitutions,
            resolveImportedType,
            context,
            resolvePropertyKeyDomain,
          ),
        ),
      resolveObjectPropertyKeyDomain(
        first,
        environment,
        substitutions,
        resolveImportedType,
        context,
        resolvePropertyKeyDomain,
      ),
    );
  }
  if (unwrapped.type === "TSNeverKeyword") {
    return { ...emptyPropertyKeyDomain(), numbers: true, strings: true, symbols: true };
  }
  if (unwrapped.type === "TSArrayType" || unwrapped.type === "TSTupleType") {
    return { ...emptyPropertyKeyDomain(), numbers: true };
  }
  if (unwrapped.type !== "TSTypeReference") return emptyPropertyKeyDomain();
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return resolveObjectPropertyKeyDomain(
        substitution.type,
        substitution.environment,
        substitution.substitutions,
        substitution.resolveImportedType,
        context,
        resolvePropertyKeyDomain,
      );
    }
    const builtIn = builtInObjectPropertyKeyDomain(
      name,
      unwrapped.typeArguments?.params ?? [],
      environment,
      substitutions,
      resolveImportedType,
      context,
      resolvePropertyKeyDomain,
    );
    if (builtIn !== null) return builtIn;
  }
  return unionPropertyKeyDomains(
    resolveTypeReference(unwrapped, environment, substitutions, resolveImportedType).map(
      (resolved) => resolvedObjectPropertyKeyDomain(resolved, context, resolvePropertyKeyDomain),
    ),
  );
}
