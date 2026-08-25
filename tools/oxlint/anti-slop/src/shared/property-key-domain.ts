import type { PortableNode, PortableTSType } from "./portable-ast.ts";
import {
  resolveMappedPropertyKeyDomain,
  resolveObjectPropertyKeyDomain,
} from "./keyof-property-key-domain.ts";
import {
  emptyPropertyKeyDomain,
  intersectPropertyKeyDomains,
  propertyKeyDomainValueId,
  subtractPropertyKeyDomains,
  unknownPropertyKeyDomain,
  unionPropertyKeyDomains,
  type PropertyKeyDomain,
} from "./property-key-domain-model.ts";
import { resolveTypeQueryPropertyKeyDomain } from "./property-key-type-query.ts";
import { resolveTypePropertyKeyDomain } from "./qualified-property-key-domain.ts";
import {
  aliasSubstitution,
  enterTypeResolution,
  expressionTypeNameParts,
  isBuiltInType,
  isUnappliedReferenceTo,
  resolveTypeReference,
  TRANSPARENT_TYPE_WRAPPERS,
  typeReferenceName,
  unwrapTransparentType,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type TypeSubstitutions,
} from "./portable-type-resolution.ts";
import { resolveTemplateLiteralKeyDomain } from "./template-property-key-domain.ts";
import { decodeTypeScriptLiteral } from "./typescript-literal.ts";
import { resolveUniqueSymbolReferenceDomain } from "./unique-symbol-property-key-domain.ts";

export { portablePropertyKeyValue } from "./keyof-property-key-domain.ts";
export {
  intersectPropertyKeyDomains,
  propertyKeyDomainIsBroad,
  propertyKeyDomainIsExact,
  propertyKeyDomainMatches,
  propertyKeyDomainIncludes,
  propertyKeyDomainAtomicDomains,
  propertyKeyDomainConcreteValues,
  propertyKeyDomainFromValue,
  subtractPropertyKeyDomains,
} from "./property-key-domain-model.ts";
export type { PropertyKeyDomain } from "./property-key-domain-model.ts";

export function resolvePropertyKeyExpressionDomain(
  key: PortableNode,
  environment: PortableTypeEnvironment,
  resolveImportedType: PortableTypeResolver | undefined,
): PropertyKeyDomain {
  return resolveUniqueSymbolReferenceDomain(
    { kind: "name", parts: expressionTypeNameParts(key) },
    environment,
    resolveImportedType,
  );
}

type PropertyKeyDomainResolver = (
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
) => PropertyKeyDomain;

function resolveExcludePropertyKeyDomain(
  source: PortableTSType,
  excluded: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
): PropertyKeyDomain {
  return subtractPropertyKeyDomains(
    resolveDomain(
      source,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    ),
    resolveDomain(
      excluded,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    ),
  );
}

/** Resolve the string, number, symbol, and literal keys admitted by a type. */
export function resolvePropertyKeyDomain(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
  resolving: ReadonlySet<string> = new Set(),
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain> = new Map(),
): PropertyKeyDomain {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSStringKeyword") {
    return { ...emptyPropertyKeyDomain(), strings: true };
  }
  if (unwrapped.type === "TSNumberKeyword") {
    return { ...emptyPropertyKeyDomain(), numbers: true };
  }
  if (unwrapped.type === "TSSymbolKeyword") {
    return { ...emptyPropertyKeyDomain(), symbols: true };
  }
  if (unwrapped.type === "TSUnknownKeyword") return unknownPropertyKeyDomain();
  if (unwrapped.type === "TSLiteralType") {
    const literal = decodeTypeScriptLiteral(unwrapped.literal);
    return literal !== null && (literal.kind === "string" || literal.kind === "number")
      ? {
          ...emptyPropertyKeyDomain(),
          values: new Set([propertyKeyDomainValueId(literal.propertyKey)]),
        }
      : emptyPropertyKeyDomain();
  }
  if (unwrapped.type === "TSTemplateLiteralType") {
    return resolveTemplateLiteralKeyDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvePropertyKeyDomain,
    );
  }
  if (unwrapped.type === "TSUnionType") {
    return unionPropertyKeyDomains(
      unwrapped.types.map((member) =>
        resolvePropertyKeyDomain(
          member,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
          keyDomainSubstitutions,
        ),
      ),
    );
  }
  if (unwrapped.type === "TSIntersectionType") {
    const [first, ...rest] = unwrapped.types;
    if (first === undefined) return emptyPropertyKeyDomain();
    return rest.reduce(
      (domain, member) =>
        intersectPropertyKeyDomains(
          domain,
          resolvePropertyKeyDomain(
            member,
            environment,
            substitutions,
            resolveImportedType,
            resolving,
            keyDomainSubstitutions,
          ),
        ),
      resolvePropertyKeyDomain(
        first,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
      ),
    );
  }
  if (unwrapped.type === "TSIndexedAccessType") {
    const indexDomain = resolvePropertyKeyDomain(
      unwrapped.indexType,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
    );
    const resolution = resolveTypePropertyKeyDomain(
      unwrapped.objectType,
      [indexDomain],
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvePropertyKeyDomain,
    );
    return resolution.found ? resolution.value : emptyPropertyKeyDomain();
  }
  if (unwrapped.type === "TSTypeQuery") {
    return resolveTypeQueryPropertyKeyDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolvePropertyKeyDomain,
      resolveTypePropertyKeyDomain,
    );
  }
  if (unwrapped.type === "TSTypeOperator" && unwrapped.operator === "keyof") {
    return resolveObjectPropertyKeyDomain(
      unwrapped.typeAnnotation,
      environment,
      substitutions,
      resolveImportedType,
      { keyDomainSubstitutions, resolving },
      resolvePropertyKeyDomain,
    );
  }
  if (unwrapped.type !== "TSTypeReference") return emptyPropertyKeyDomain();
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const keyDomainSubstitution = keyDomainSubstitutions.get(name);
    if (keyDomainSubstitution !== undefined) return keyDomainSubstitution;
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return resolvePropertyKeyDomain(
        substitution.type,
        substitution.environment,
        substitution.substitutions,
        substitution.resolveImportedType,
        resolving,
        keyDomainSubstitutions,
      );
    }
    if (name === "PropertyKey" && isBuiltInType(name, environment)) {
      return {
        ...emptyPropertyKeyDomain(),
        numbers: true,
        strings: true,
        symbols: true,
      };
    }
    if (name === "Exclude" && isBuiltInType(name, environment)) {
      const [source, excluded] = unwrapped.typeArguments?.params ?? [];
      return source === undefined || excluded === undefined
        ? emptyPropertyKeyDomain()
        : resolveExcludePropertyKeyDomain(
            source,
            excluded,
            environment,
            substitutions,
            resolveImportedType,
            resolving,
            resolvePropertyKeyDomain,
            keyDomainSubstitutions,
          );
    }
  }
  const domains: PropertyKeyDomain[] = [];
  for (const resolved of resolveTypeReference(
    unwrapped,
    environment,
    substitutions,
    resolveImportedType,
  )) {
    if (resolved.kind !== "alias") continue;
    const nextResolving = enterTypeResolution(resolving, resolved.key, "property-key-domain");
    if (nextResolving === null) continue;
    const aliasSubstitutions = aliasSubstitution(
      resolved.declaration,
      resolved.arguments,
      resolved.environment,
      resolved.resolveImportedType,
    );
    if (aliasSubstitutions === null) continue;
    domains.push(
      resolvePropertyKeyDomain(
        resolved.declaration.typeAnnotation,
        resolved.environment,
        aliasSubstitutions,
        resolved.resolveImportedType,
        nextResolving,
        keyDomainSubstitutions,
      ),
    );
  }
  return unionPropertyKeyDomains(domains);
}

/** Resolve the remaining open key space of a dictionary-like type. */
export function resolveOpenDictionaryKeyDomain(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
  resolving: ReadonlySet<string> = new Set(),
): PropertyKeyDomain {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSTypeLiteral") {
    return unionPropertyKeyDomains(
      unwrapped.members.flatMap((member): readonly PropertyKeyDomain[] => {
        if (member.type !== "TSIndexSignature") return [];
        const keyType = member.parameters[0]?.typeAnnotation.typeAnnotation;
        return keyType === undefined
          ? []
          : [
              resolvePropertyKeyDomain(
                keyType,
                environment,
                substitutions,
                resolveImportedType,
                resolving,
              ),
            ];
      }),
    );
  }
  if (unwrapped.type === "TSMappedType") {
    return resolveMappedPropertyKeyDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      { keyDomainSubstitutions: new Map(), resolving },
      resolvePropertyKeyDomain,
    );
  }
  if (unwrapped.type !== "TSTypeReference") return emptyPropertyKeyDomain();
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return resolveOpenDictionaryKeyDomain(
        substitution.type,
        substitution.environment,
        substitution.substitutions,
        substitution.resolveImportedType,
        resolving,
      );
    }
    if (TRANSPARENT_TYPE_WRAPPERS.has(name) && isBuiltInType(name, environment)) {
      const wrapped = unwrapped.typeArguments?.params[0];
      return wrapped === undefined
        ? emptyPropertyKeyDomain()
        : resolveOpenDictionaryKeyDomain(
            wrapped,
            environment,
            substitutions,
            resolveImportedType,
            resolving,
          );
    }
    if (name === "Record" && isBuiltInType(name, environment)) {
      const key = unwrapped.typeArguments?.params[0];
      return key === undefined
        ? emptyPropertyKeyDomain()
        : resolvePropertyKeyDomain(key, environment, substitutions, resolveImportedType, resolving);
    }
    if ((name === "Pick" || name === "Omit") && isBuiltInType(name, environment)) {
      const [source, selected] = unwrapped.typeArguments?.params ?? [];
      if (source === undefined || selected === undefined) return emptyPropertyKeyDomain();
      const sourceDomain = resolveOpenDictionaryKeyDomain(
        source,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
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
  }
  const domains: PropertyKeyDomain[] = [];
  for (const resolved of resolveTypeReference(
    unwrapped,
    environment,
    substitutions,
    resolveImportedType,
  )) {
    if (resolved.kind !== "alias") continue;
    const nextResolving = enterTypeResolution(resolving, resolved.key, "dictionary-key-domain");
    if (nextResolving === null) continue;
    const aliasSubstitutions = aliasSubstitution(
      resolved.declaration,
      resolved.arguments,
      resolved.environment,
      resolved.resolveImportedType,
    );
    if (aliasSubstitutions === null) continue;
    domains.push(
      resolveOpenDictionaryKeyDomain(
        resolved.declaration.typeAnnotation,
        resolved.environment,
        aliasSubstitutions,
        resolved.resolveImportedType,
        nextResolving,
      ),
    );
  }
  return unionPropertyKeyDomains(domains);
}
