import type {
  PortableNode,
  PortableTSInterfaceDeclaration,
  PortableTSType,
} from "./portable-ast.ts";
import {
  emptyPropertyKeyDomain,
  intersectPropertyKeyDomains,
  propertyKeyDomainValueId,
  subtractPropertyKeyDomains,
  unionPropertyKeyDomains,
  type PropertyKeyDomain,
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

type PropertyKeyDomainResolver = (
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
  resolving?: ReadonlySet<string>,
) => PropertyKeyDomain;

/** Return a statically known property key from an ESTree-compatible node. */
export function portablePropertyKeyValue(key: PortableNode): number | string | null {
  if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
  return key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")
    ? key.value
    : null;
}

function memberPropertyKeyDomain(
  member: PortableNode,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
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
      resolving,
    );
    return domain.strings ? { ...domain, numbers: true } : domain;
  }
  if (member.type !== "TSPropertySignature" && member.type !== "TSMethodSignature") {
    return emptyPropertyKeyDomain();
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
  resolving: ReadonlySet<string>,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  return unionPropertyKeyDomains(
    members.map((member) =>
      memberPropertyKeyDomain(
        member,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
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
  resolving: ReadonlySet<string>,
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
        resolving,
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
              resolving,
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
        domains.push(
          resolvedObjectPropertyKeyDomain(resolved, resolving, resolvePropertyKeyDomain),
        );
      }
    }
  }
  return unionPropertyKeyDomains(domains);
}

function resolvedObjectPropertyKeyDomain(
  resolved: ResolvedPortableType,
  resolving: ReadonlySet<string>,
  resolvePropertyKeyDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  const nextResolving = enterTypeResolution(resolving, resolved.key, "object-property-key-domain");
  if (nextResolving === null) return emptyPropertyKeyDomain();
  if (resolved.kind === "interface") {
    return interfacePropertyKeyDomain(
      resolved.declarations,
      resolved.environment,
      resolved.arguments,
      resolved.resolveImportedType,
      nextResolving,
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
        nextResolving,
        resolvePropertyKeyDomain,
      );
}

function builtInObjectPropertyKeyDomain(
  name: string,
  arguments_: readonly PortableTSType[],
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
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
          resolving,
          resolvePropertyKeyDomain,
        );
  }
  if (name === "Record") {
    const key = arguments_[0];
    return key === undefined
      ? emptyPropertyKeyDomain()
      : resolvePropertyKeyDomain(key, environment, substitutions, resolveImportedType, resolving);
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
    resolving,
    resolvePropertyKeyDomain,
  );
  const selectedDomain = resolvePropertyKeyDomain(
    selected,
    environment,
    substitutions,
    resolveImportedType,
    resolving,
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
  resolving: ReadonlySet<string>,
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
      resolving,
      resolvePropertyKeyDomain,
    );
  }
  if (unwrapped.type === "TSMappedType") {
    return resolvePropertyKeyDomain(
      unwrapped.constraint,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
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
          resolving,
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
            resolving,
            resolvePropertyKeyDomain,
          ),
        ),
      resolveObjectPropertyKeyDomain(
        first,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
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
        resolving,
        resolvePropertyKeyDomain,
      );
    }
    const builtIn = builtInObjectPropertyKeyDomain(
      name,
      unwrapped.typeArguments?.params ?? [],
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      resolvePropertyKeyDomain,
    );
    if (builtIn !== null) return builtIn;
  }
  return unionPropertyKeyDomains(
    resolveTypeReference(unwrapped, environment, substitutions, resolveImportedType).map(
      (resolved) => resolvedObjectPropertyKeyDomain(resolved, resolving, resolvePropertyKeyDomain),
    ),
  );
}
