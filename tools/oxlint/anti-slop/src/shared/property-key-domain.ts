import type { PortableTSType } from "./portable-ast.ts";
import {
  aliasSubstitution,
  enterTypeResolution,
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

export type PropertyKeyDomain = {
  readonly numbers: boolean;
  readonly strings: boolean;
  readonly symbols: boolean;
  readonly values: ReadonlySet<string>;
};

const emptyDomain = (): PropertyKeyDomain => ({
  numbers: false,
  strings: false,
  symbols: false,
  values: new Set(),
});

const valueId = (value: number | string): string =>
  `${typeof value === "number" ? "number" : "string"}\0${String(value)}`;

function unionDomains(domains: readonly PropertyKeyDomain[]): PropertyKeyDomain {
  return {
    numbers: domains.some((domain) => domain.numbers),
    strings: domains.some((domain) => domain.strings),
    symbols: domains.some((domain) => domain.symbols),
    values: new Set(domains.flatMap((domain) => [...domain.values])),
  };
}

function acceptsValue(domain: PropertyKeyDomain, id: string): boolean {
  if (domain.values.has(id)) return true;
  if (id.startsWith("number\0")) return domain.numbers;
  return domain.strings;
}

/** Resolve the string, number, symbol, and literal keys admitted by a type. */
export function resolvePropertyKeyDomain(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType?: PortableTypeResolver,
  resolving: ReadonlySet<string> = new Set(),
): PropertyKeyDomain {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSStringKeyword") {
    return { ...emptyDomain(), strings: true };
  }
  if (unwrapped.type === "TSNumberKeyword") {
    return { ...emptyDomain(), numbers: true };
  }
  if (unwrapped.type === "TSSymbolKeyword") {
    return { ...emptyDomain(), symbols: true };
  }
  if (unwrapped.type === "TSLiteralType") {
    const literal = unwrapped.literal;
    return literal.type === "Literal" &&
      (typeof literal.value === "string" || typeof literal.value === "number")
      ? { ...emptyDomain(), values: new Set([valueId(literal.value)]) }
      : emptyDomain();
  }
  if (unwrapped.type === "TSUnionType") {
    return unionDomains(
      unwrapped.types.map((member) =>
        resolvePropertyKeyDomain(
          member,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
        ),
      ),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return emptyDomain();
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return resolvePropertyKeyDomain(
        substitution.type,
        substitution.environment,
        substitution.substitutions,
        substitution.resolveImportedType,
        resolving,
      );
    }
    if (name === "PropertyKey" && isBuiltInType(name, environment)) {
      return { ...emptyDomain(), numbers: true, strings: true, symbols: true };
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
      ),
    );
  }
  return unionDomains(domains);
}

export function propertyKeyDomainIsBroad(domain: PropertyKeyDomain): boolean {
  return domain.numbers || domain.strings || domain.symbols;
}

export function propertyKeyDomainIncludes(
  domain: PropertyKeyDomain,
  candidate: PropertyKeyDomain,
): boolean {
  if (candidate.numbers && !domain.numbers) return false;
  if (candidate.strings && !domain.strings) return false;
  if (candidate.symbols && !domain.symbols) return false;
  return [...candidate.values].every((value) => acceptsValue(domain, value));
}

export function propertyKeyDomainMatches(
  domain: PropertyKeyDomain,
  value: number | string,
): boolean {
  return acceptsValue(domain, valueId(value));
}

export function intersectPropertyKeyDomains(
  left: PropertyKeyDomain,
  right: PropertyKeyDomain,
): PropertyKeyDomain {
  const values = new Set<string>();
  for (const value of left.values) {
    if (acceptsValue(right, value)) values.add(value);
  }
  for (const value of right.values) {
    if (acceptsValue(left, value)) values.add(value);
  }
  return {
    numbers: left.numbers && right.numbers,
    strings: left.strings && right.strings,
    symbols: left.symbols && right.symbols,
    values,
  };
}

export function subtractPropertyKeyDomains(
  source: PropertyKeyDomain,
  excluded: PropertyKeyDomain,
): PropertyKeyDomain {
  return {
    numbers: source.numbers && !excluded.numbers,
    strings: source.strings && !excluded.strings,
    symbols: source.symbols && !excluded.symbols,
    values: new Set([...source.values].filter((value) => !acceptsValue(excluded, value))),
  };
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
    return unionDomains(
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
    return resolvePropertyKeyDomain(
      unwrapped.constraint,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
    );
  }
  if (unwrapped.type !== "TSTypeReference") return emptyDomain();
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
        ? emptyDomain()
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
        ? emptyDomain()
        : resolvePropertyKeyDomain(key, environment, substitutions, resolveImportedType, resolving);
    }
    if ((name === "Pick" || name === "Omit") && isBuiltInType(name, environment)) {
      const [source, selected] = unwrapped.typeArguments?.params ?? [];
      if (source === undefined || selected === undefined) return emptyDomain();
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
  return unionDomains(domains);
}
