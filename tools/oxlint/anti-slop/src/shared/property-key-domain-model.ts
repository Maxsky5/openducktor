export type PropertyKeyPattern =
  | { readonly kind: "bigint-interpolation" }
  | { readonly kind: "intersection"; readonly patterns: readonly PropertyKeyPattern[] }
  | { readonly kind: "number-interpolation" }
  | { readonly kind: "regular-expression"; readonly source: string }
  | {
      readonly interpolations: readonly PropertyKeyPattern[];
      readonly kind: "template";
      readonly quasis: readonly string[];
    }
  | { readonly kind: "union"; readonly patterns: readonly PropertyKeyPattern[] };

export type PropertyKeyDomain = {
  readonly numbers: boolean;
  readonly patterns: readonly PropertyKeyPattern[];
  readonly strings: boolean;
  readonly symbols: boolean;
  readonly values: ReadonlySet<string>;
};

export const emptyPropertyKeyDomain = (): PropertyKeyDomain => ({
  numbers: false,
  patterns: [],
  strings: false,
  symbols: false,
  values: new Set(),
});

export const propertyKeyDomainValueId = (value: number | string): string =>
  `${typeof value === "number" ? "number" : "string"}\0${String(value)}`;

function valueKind(id: string): "number" | "string" {
  return id.startsWith("number\0") ? "number" : "string";
}

export function propertyKeyDomainValueText(id: string): string {
  return id.slice(id.indexOf("\0") + 1);
}

export const regularExpressionPropertyKeyPattern = (source: string): PropertyKeyPattern => ({
  kind: "regular-expression",
  source,
});

export const numberInterpolationPropertyKeyPattern = (): PropertyKeyPattern => ({
  kind: "number-interpolation",
});

export const bigintInterpolationPropertyKeyPattern = (): PropertyKeyPattern => ({
  kind: "bigint-interpolation",
});

function unorderedPatternsEqual(
  left: readonly PropertyKeyPattern[],
  right: readonly PropertyKeyPattern[],
): boolean {
  return (
    left.length === right.length &&
    left.every((leftPattern) =>
      right.some((rightPattern) => patternsEqual(leftPattern, rightPattern)),
    )
  );
}

function patternsEqual(left: PropertyKeyPattern, right: PropertyKeyPattern): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "number-interpolation" || left.kind === "bigint-interpolation") return true;
  if (left.kind === "regular-expression" && right.kind === "regular-expression") {
    return left.source === right.source;
  }
  if (left.kind === "template" && right.kind === "template") {
    return (
      left.quasis.length === right.quasis.length &&
      left.quasis.every((quasi, index) => quasi === right.quasis[index]) &&
      left.interpolations.length === right.interpolations.length &&
      left.interpolations.every((interpolation, index) => {
        const rightInterpolation = right.interpolations[index];
        return rightInterpolation !== undefined && patternsEqual(interpolation, rightInterpolation);
      })
    );
  }
  if (left.kind === "union" && right.kind === "union") {
    return unorderedPatternsEqual(left.patterns, right.patterns);
  }
  if (left.kind === "intersection" && right.kind === "intersection") {
    return unorderedPatternsEqual(left.patterns, right.patterns);
  }
  return false;
}

function uniquePatterns(patterns: readonly PropertyKeyPattern[]): readonly PropertyKeyPattern[] {
  return patterns.filter(
    (pattern, index) => !patterns.slice(0, index).some((other) => patternsEqual(pattern, other)),
  );
}

export function unionPropertyKeyPatterns(
  patterns: readonly PropertyKeyPattern[],
): PropertyKeyPattern {
  const unique = uniquePatterns(
    patterns.flatMap((pattern) => (pattern.kind === "union" ? pattern.patterns : [pattern])),
  );
  return unique.length === 1
    ? (unique[0] ?? regularExpressionPropertyKeyPattern("(?!)"))
    : { kind: "union", patterns: unique };
}

export function templatePropertyKeyPattern(
  quasis: readonly string[],
  interpolations: readonly PropertyKeyPattern[],
): PropertyKeyPattern {
  return { interpolations, kind: "template", quasis };
}

function templatePatternMatches(
  pattern: Extract<PropertyKeyPattern, { kind: "template" }>,
  value: string,
  interpolationIndex = 0,
  offset = 0,
): boolean {
  const quasi = pattern.quasis[interpolationIndex] ?? "";
  if (!value.startsWith(quasi, offset)) return false;
  const interpolationStart = offset + quasi.length;
  const interpolation = pattern.interpolations[interpolationIndex];
  if (interpolation === undefined) return interpolationStart === value.length;
  for (
    let interpolationEnd = interpolationStart;
    interpolationEnd <= value.length;
    interpolationEnd += 1
  ) {
    if (!patternMatches(interpolation, value.slice(interpolationStart, interpolationEnd))) continue;
    if (templatePatternMatches(pattern, value, interpolationIndex + 1, interpolationEnd))
      return true;
  }
  return false;
}

function patternMatches(pattern: PropertyKeyPattern, value: string): boolean {
  if (pattern.kind === "number-interpolation") {
    return value !== "" && Number.isFinite(Number(value));
  }
  if (pattern.kind === "bigint-interpolation") {
    return /^-?(?:0|[1-9]\d*|0[xX][\dA-Fa-f]+|0[bB][01]+|0[oO][0-7]+)$/u.test(value);
  }
  if (pattern.kind === "regular-expression") return new RegExp(pattern.source, "u").test(value);
  if (pattern.kind === "template") return templatePatternMatches(pattern, value);
  if (pattern.kind === "union") {
    return pattern.patterns.some((member) => patternMatches(member, value));
  }
  if (pattern.kind === "intersection") {
    return pattern.patterns.every((member) => patternMatches(member, value));
  }
  return false;
}

function acceptsDomainValue(domain: PropertyKeyDomain, id: string): boolean {
  if (domain.values.has(id)) return true;
  if (valueKind(id) === "number") return domain.numbers;
  return (
    domain.strings ||
    domain.patterns.some((pattern) => patternMatches(pattern, propertyKeyDomainValueText(id)))
  );
}

function isCanonicalNumericPropertyName(value: string): boolean {
  if (value === "0") return true;
  if (value === "NaN" || value === "Infinity" || value === "-Infinity") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(numeric) === value;
}

function acceptsConcreteValue(domain: PropertyKeyDomain, value: number | string): boolean {
  const text = String(value);
  if (domain.strings || domain.values.has(propertyKeyDomainValueId(value))) return true;
  if (domain.patterns.some((pattern) => patternMatches(pattern, text))) return true;
  if (typeof value === "number") {
    return domain.numbers || domain.values.has(propertyKeyDomainValueId(text));
  }
  return (
    isCanonicalNumericPropertyName(value) &&
    (domain.numbers || domain.values.has(propertyKeyDomainValueId(Number(value))))
  );
}

export function unionPropertyKeyDomains(domains: readonly PropertyKeyDomain[]): PropertyKeyDomain {
  return {
    numbers: domains.some((domain) => domain.numbers),
    patterns: uniquePatterns(domains.flatMap((domain) => domain.patterns)),
    strings: domains.some((domain) => domain.strings),
    symbols: domains.some((domain) => domain.symbols),
    values: new Set(domains.flatMap((domain) => [...domain.values])),
  };
}

export function propertyKeyDomainIsBroad(domain: PropertyKeyDomain): boolean {
  return domain.numbers || domain.patterns.length > 0 || domain.strings || domain.symbols;
}

function patternIncludes(container: PropertyKeyPattern, candidate: PropertyKeyPattern): boolean {
  if (patternsEqual(container, candidate)) return true;
  if (candidate.kind === "union") {
    return candidate.patterns.every((pattern) => patternIncludes(container, pattern));
  }
  if (candidate.kind === "intersection") {
    return candidate.patterns.some((pattern) => patternIncludes(container, pattern));
  }
  if (container.kind === "union") {
    return container.patterns.some((pattern) => patternIncludes(pattern, candidate));
  }
  if (container.kind === "intersection") {
    return container.patterns.every((pattern) => patternIncludes(pattern, candidate));
  }
  return false;
}

export function propertyKeyDomainIncludes(
  domain: PropertyKeyDomain,
  candidate: PropertyKeyDomain,
): boolean {
  if (candidate.numbers && !domain.numbers && !domain.strings) return false;
  if (candidate.strings && !domain.strings) return false;
  if (candidate.symbols && !domain.symbols) return false;
  if (
    candidate.patterns.some(
      (candidatePattern) =>
        !domain.strings &&
        !domain.patterns.some((domainPattern) => patternIncludes(domainPattern, candidatePattern)),
    )
  ) {
    return false;
  }
  return [...candidate.values].every((value) =>
    acceptsConcreteValue(
      domain,
      valueKind(value) === "number"
        ? Number(propertyKeyDomainValueText(value))
        : propertyKeyDomainValueText(value),
    ),
  );
}

export function propertyKeyDomainMatches(
  domain: PropertyKeyDomain,
  value: number | string,
): boolean {
  return acceptsConcreteValue(domain, value);
}

function intersectionPattern(
  left: PropertyKeyPattern,
  right: PropertyKeyPattern,
): PropertyKeyPattern {
  const patterns = uniquePatterns(
    [left, right].flatMap((pattern) =>
      pattern.kind === "intersection" ? pattern.patterns : [pattern],
    ),
  );
  return patterns.length === 1
    ? (patterns[0] ?? regularExpressionPropertyKeyPattern("(?!)"))
    : { kind: "intersection", patterns };
}

export function intersectPropertyKeyDomains(
  left: PropertyKeyDomain,
  right: PropertyKeyDomain,
): PropertyKeyDomain {
  const values = new Set<string>();
  for (const value of left.values) {
    if (acceptsDomainValue(right, value)) values.add(value);
  }
  for (const value of right.values) {
    if (acceptsDomainValue(left, value)) values.add(value);
  }
  const patterns: PropertyKeyPattern[] = [];
  if (left.strings) patterns.push(...right.patterns);
  if (right.strings) patterns.push(...left.patterns);
  for (const leftPattern of left.patterns) {
    for (const rightPattern of right.patterns) {
      patterns.push(intersectionPattern(leftPattern, rightPattern));
    }
  }
  return {
    numbers: left.numbers && right.numbers,
    patterns: uniquePatterns(patterns),
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
    patterns: excluded.strings
      ? []
      : source.patterns.filter(
          (sourcePattern) =>
            !excluded.patterns.some((excludedPattern) =>
              patternIncludes(excludedPattern, sourcePattern),
            ),
        ),
    strings: source.strings && !excluded.strings,
    symbols: source.symbols && !excluded.symbols,
    values: new Set([...source.values].filter((value) => !acceptsDomainValue(excluded, value))),
  };
}

/** Decide whether a concrete property remains visible after Pick or Omit. */
export function propertyKeySurvivesTransform(
  transform: "Omit" | "Pick",
  sourceOpenDomain: PropertyKeyDomain,
  selectedDomain: PropertyKeyDomain,
  value: number | string,
): boolean {
  if (transform === "Pick") return propertyKeyDomainMatches(selectedDomain, value);
  if (!propertyKeyDomainMatches(selectedDomain, value)) return true;
  return propertyKeyDomainMatches(
    subtractPropertyKeyDomains(sourceOpenDomain, selectedDomain),
    value,
  );
}
