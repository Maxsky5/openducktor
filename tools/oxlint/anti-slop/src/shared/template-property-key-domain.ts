import type { PortableTSType } from "./portable-ast.ts";
import {
  anyStringInterpolationPropertyKeyPattern,
  bigintInterpolationPropertyKeyPattern,
  emptyPropertyKeyDomain,
  intersectPropertyKeyDomains,
  literalInterpolationPropertyKeyPattern,
  numberInterpolationPropertyKeyPattern,
  propertyKeyDomainValueId,
  propertyKeyDomainValueText,
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
  typeReferenceName,
  unwrapTransparentType,
  type PortableTypeEnvironment,
  type PortableTypeResolver,
  type TypeSubstitutions,
} from "./portable-type-resolution.ts";
import { decodeTypeScriptLiteral } from "./typescript-literal.ts";

type PropertyKeyDomainResolver = (
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
) => PropertyKeyDomain;

const numberInterpolationPattern = numberInterpolationPropertyKeyPattern();
const bigintInterpolationPattern = bigintInterpolationPropertyKeyPattern();

function stringValueDomain(values: readonly string[]): PropertyKeyDomain {
  return {
    ...emptyPropertyKeyDomain(),
    values: new Set(values.map((value) => propertyKeyDomainValueId(value))),
  };
}

function templateInterpolationPattern(domain: PropertyKeyDomain): PropertyKeyPattern | null {
  const patterns = [
    ...(domain.strings ? [anyStringInterpolationPropertyKeyPattern()] : []),
    ...(domain.numbers ? [numberInterpolationPattern] : []),
    ...[...domain.values].map((value) =>
      literalInterpolationPropertyKeyPattern(propertyKeyDomainValueText(value)),
    ),
    ...domain.patterns,
  ];
  return unionPropertyKeyPatterns(patterns);
}

function resolveExcludePropertyKeyDomain(
  source: PortableTSType,
  excluded: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
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

function resolveTemplateInterpolationDomain(
  type: PortableTSType,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
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
    return resolveDomain(
      unwrapped,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
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
          keyDomainSubstitutions,
          resolveDomain,
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
            keyDomainSubstitutions,
            resolveDomain,
          ),
        ),
      resolveTemplateInterpolationDomain(
        first,
        environment,
        substitutions,
        resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolveDomain,
      ),
    );
  }
  if (unwrapped.type !== "TSTypeReference") return emptyPropertyKeyDomain();
  const name = typeReferenceName(unwrapped);
  if (name !== null) {
    const keyDomainSubstitution = keyDomainSubstitutions.get(name);
    if (keyDomainSubstitution !== undefined) return keyDomainSubstitution;
    const substitution = substitutions.get(name);
    if (substitution !== undefined && !isUnappliedReferenceTo(substitution.type, name)) {
      return resolveTemplateInterpolationDomain(
        substitution.type,
        substitution.environment,
        substitution.substitutions,
        substitution.resolveImportedType,
        resolving,
        keyDomainSubstitutions,
        resolveDomain,
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
            keyDomainSubstitutions,
            (
              member,
              memberEnvironment,
              memberSubstitutions,
              memberResolver,
              memberResolving,
              memberKeySubstitutions,
            ) =>
              resolveTemplateInterpolationDomain(
                member,
                memberEnvironment,
                memberSubstitutions,
                memberResolver,
                memberResolving,
                memberKeySubstitutions,
                resolveDomain,
              ),
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
        keyDomainSubstitutions,
        resolveDomain,
      ),
    );
  }
  return unionPropertyKeyDomains(domains);
}

export function resolveTemplateLiteralKeyDomain(
  type: Extract<PortableTSType, { type: "TSTemplateLiteralType" }>,
  environment: PortableTypeEnvironment,
  substitutions: TypeSubstitutions,
  resolveImportedType: PortableTypeResolver | undefined,
  resolving: ReadonlySet<string>,
  keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>,
  resolveDomain: PropertyKeyDomainResolver,
): PropertyKeyDomain {
  const interpolationDomains = type.types.map((member) =>
    resolveTemplateInterpolationDomain(
      member,
      environment,
      substitutions,
      resolveImportedType,
      resolving,
      keyDomainSubstitutions,
      resolveDomain,
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
