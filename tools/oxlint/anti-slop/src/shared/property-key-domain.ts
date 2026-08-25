import type { PortableTSType } from "./portable-ast.ts";
import { resolveObjectPropertyKeyDomain } from "./keyof-property-key-domain.ts";
import {
  bigintInterpolationPropertyKeyPattern,
  emptyPropertyKeyDomain,
  intersectPropertyKeyDomains,
  numberInterpolationPropertyKeyPattern,
  propertyKeyDomainValueId,
  propertyKeyDomainValueText,
  regularExpressionPropertyKeyPattern,
  subtractPropertyKeyDomains,
  templatePropertyKeyPattern,
  unionPropertyKeyDomains,
  unionPropertyKeyPatterns,
  type PropertyKeyDomain,
  type PropertyKeyPattern,
} from "./property-key-domain-model.ts";
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

export { portablePropertyKeyValue } from "./keyof-property-key-domain.ts";
export {
  intersectPropertyKeyDomains,
  propertyKeyDomainIncludes,
  propertyKeyDomainIsBroad,
  propertyKeyDomainMatches,
  propertyKeySurvivesTransform,
  subtractPropertyKeyDomains,
} from "./property-key-domain-model.ts";
export type { PropertyKeyDomain } from "./property-key-domain-model.ts";

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const numberInterpolationPattern = numberInterpolationPropertyKeyPattern();
const bigintInterpolationPattern = bigintInterpolationPropertyKeyPattern();

type DecodedTypeScriptLiteral =
  | { readonly kind: "bigint"; readonly text: string }
  | { readonly kind: "boolean"; readonly text: string }
  | { readonly kind: "number"; readonly propertyKey: number; readonly text: string }
  | { readonly kind: "string"; readonly propertyKey: string; readonly text: string };

function decodeTypeScriptLiteral(
  literal: Extract<PortableTSType, { type: "TSLiteralType" }>["literal"],
): DecodedTypeScriptLiteral | null {
  if (literal.type === "Literal") {
    if ("bigint" in literal) return { kind: "bigint", text: literal.bigint };
    if (typeof literal.value === "string") {
      return { kind: "string", propertyKey: literal.value, text: literal.value };
    }
    if (typeof literal.value === "number") {
      return { kind: "number", propertyKey: literal.value, text: String(literal.value) };
    }
    if (typeof literal.value === "boolean") {
      return { kind: "boolean", text: String(literal.value) };
    }
    return null;
  }
  if (
    literal.type !== "UnaryExpression" ||
    (literal.operator !== "+" && literal.operator !== "-") ||
    literal.argument.type !== "Literal"
  ) {
    return null;
  }
  const argument = literal.argument;
  if ("bigint" in argument) {
    const text =
      literal.operator === "-" && argument.bigint !== "0" ? `-${argument.bigint}` : argument.bigint;
    return { kind: "bigint", text };
  }
  if (typeof argument.value !== "number") return null;
  const value = literal.operator === "-" ? -argument.value : argument.value;
  return { kind: "number", propertyKey: value, text: String(value) };
}

function stringValueDomain(values: readonly string[]): PropertyKeyDomain {
  return {
    ...emptyPropertyKeyDomain(),
    values: new Set(values.map((value) => propertyKeyDomainValueId(value))),
  };
}

function templateInterpolationPattern(domain: PropertyKeyDomain): PropertyKeyPattern | null {
  const patterns = [
    ...(domain.strings ? [regularExpressionPropertyKeyPattern("^.*$")] : []),
    ...(domain.numbers ? [numberInterpolationPattern] : []),
    ...[...domain.values].map((value) =>
      regularExpressionPropertyKeyPattern(
        `^${escapeRegularExpression(propertyKeyDomainValueText(value))}$`,
      ),
    ),
    ...domain.patterns,
  ];
  return patterns.length === 0 ? null : unionPropertyKeyPatterns(patterns);
}

type PropertyKeyDomainResolver = (
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
) => PropertyKeyDomain;

function resolveExcludePropertyKeyDomain(
  source: PortableTSType,
  excluded: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  resolveDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  return subtractPropertyKeyDomains(
    resolveDomain(source, environment, substitutions, resolveImportedType, resolving),
    resolveDomain(excluded, environment, substitutions, resolveImportedType, resolving),
  );
}

function resolveTemplateInterpolationDomain(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
): PropertyKeyDomain {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSStringKeyword") {
    return { ...emptyPropertyKeyDomain(), strings: true };
  }
  if (unwrapped.type === "TSNumberKeyword") {
    return { ...emptyPropertyKeyDomain(), patterns: [numberInterpolationPattern] };
  }
  if (unwrapped.type === "TSBigIntKeyword") {
    return { ...emptyPropertyKeyDomain(), patterns: [bigintInterpolationPattern] };
  }
  if (unwrapped.type === "TSBooleanKeyword") return stringValueDomain(["false", "true"]);
  if (unwrapped.type === "TSNullKeyword") return stringValueDomain(["null"]);
  if (unwrapped.type === "TSUndefinedKeyword") return stringValueDomain(["undefined"]);
  if (unwrapped.type === "TSLiteralType") {
    const literal = decodeTypeScriptLiteral(unwrapped.literal);
    return literal === null ? emptyPropertyKeyDomain() : stringValueDomain([literal.text]);
  }
  if (unwrapped.type === "TSTemplateLiteralType") {
    return resolvePropertyKeyDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
    );
  }
  if (unwrapped.type === "TSUnionType") {
    return unionPropertyKeyDomains(
      unwrapped.types.map((member) =>
        resolveTemplateInterpolationDomain(
          member,
          environment,
          substitutions,
          resolveImportedType,
          resolving,
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
          resolveTemplateInterpolationDomain(
            member,
            environment,
            substitutions,
            resolveImportedType,
            resolving,
          ),
        ),
      resolveTemplateInterpolationDomain(
        first,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
      ),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return emptyPropertyKeyDomain();
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return resolveTemplateInterpolationDomain(
        substitution.type,
        substitution.environment,
        substitution.substitutions,
        substitution.resolveImportedType,
        resolving,
      );
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
            resolveTemplateInterpolationDomain,
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
    const nextResolving = enterTypeResolution(resolving, resolved.key, "template-interpolation");
    if (nextResolving === null) continue;
    const aliasSubstitutions = aliasSubstitution(
      resolved.declaration,
      resolved.arguments,
      resolved.environment,
      resolved.resolveImportedType,
    );
    if (aliasSubstitutions === null) continue;
    domains.push(
      resolveTemplateInterpolationDomain(
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

function templateLiteralKeyDomain(
  type: Extract<PortableTSType, { type: "TSTemplateLiteralType" }>,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
): PropertyKeyDomain {
  const interpolationDomains = type.types.map((member) =>
    resolveTemplateInterpolationDomain(
      member,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
    ),
  );
  const allFinite = interpolationDomains.every(
    (domain) =>
      !domain.numbers && !domain.strings && !domain.symbols && domain.patterns.length === 0,
  );
  if (allFinite) {
    let values = [type.quasis[0]?.value.cooked ?? ""];
    for (const [index, domain] of interpolationDomains.entries()) {
      const suffix = type.quasis[index + 1]?.value.cooked ?? "";
      values = values.flatMap((prefix) =>
        [...domain.values].map((value) => `${prefix}${propertyKeyDomainValueText(value)}${suffix}`),
      );
    }
    return {
      ...emptyPropertyKeyDomain(),
      values: new Set(values.map((value) => propertyKeyDomainValueId(value))),
    };
  }
  const patterns: PropertyKeyPattern[] = [];
  for (const domain of interpolationDomains) {
    const interpolation = templateInterpolationPattern(domain);
    if (interpolation === null) return emptyPropertyKeyDomain();
    patterns.push(interpolation);
  }
  return {
    ...emptyPropertyKeyDomain(),
    patterns: [
      templatePropertyKeyPattern(
        type.quasis.map((quasi) => quasi.value.cooked ?? ""),
        patterns,
      ),
    ],
  };
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
    return { ...emptyPropertyKeyDomain(), strings: true };
  }
  if (unwrapped.type === "TSNumberKeyword") {
    return { ...emptyPropertyKeyDomain(), numbers: true };
  }
  if (unwrapped.type === "TSSymbolKeyword") {
    return { ...emptyPropertyKeyDomain(), symbols: true };
  }
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
    return templateLiteralKeyDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
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
          ),
        ),
      resolvePropertyKeyDomain(first, environment, substitutions, resolveImportedType, resolving),
    );
  }
  if (unwrapped.type === "TSTypeOperator" && unwrapped.operator === "keyof") {
    return resolveObjectPropertyKeyDomain(
      unwrapped.typeAnnotation,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      resolvePropertyKeyDomain,
    );
  }
  if (unwrapped.type !== "TSTypeReference") return emptyPropertyKeyDomain();
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
    return resolvePropertyKeyDomain(
      unwrapped.constraint,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
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
