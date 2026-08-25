type NonEmptyPropertyKeyPatterns = readonly [PropertyKeyPattern, ...PropertyKeyPattern[]];

export type PropertyKeyPattern =
  | { readonly kind: "any-string-interpolation" }
  | { readonly kind: "bigint-interpolation" }
  | { readonly kind: "intersection"; readonly patterns: NonEmptyPropertyKeyPatterns }
  | { readonly kind: "literal-interpolation"; readonly value: string }
  | { readonly kind: "number-interpolation" }
  | {
      readonly interpolations: readonly PropertyKeyPattern[];
      readonly kind: "template";
      readonly quasis: readonly string[];
    }
  | { readonly kind: "union"; readonly patterns: NonEmptyPropertyKeyPatterns };

export type PropertyKeyDomain = {
  readonly numbers: boolean;
  readonly patterns: readonly PropertyKeyPattern[];
  readonly strings: boolean;
  readonly symbols: boolean;
  readonly unknown: boolean;
  readonly uniqueSymbols: ReadonlySet<string>;
  readonly values: ReadonlySet<string>;
};

export type PropertyKeyResolutionContext = {
  readonly keyDomainSubstitutions: ReadonlyMap<string, PropertyKeyDomain>;
  readonly resolving: ReadonlySet<string>;
};

export const emptyPropertyKeyDomain = (): PropertyKeyDomain => ({
  numbers: false,
  patterns: [],
  strings: false,
  symbols: false,
  unknown: false,
  uniqueSymbols: new Set(),
  values: new Set(),
});

export const unknownPropertyKeyDomain = (): PropertyKeyDomain => ({
  ...emptyPropertyKeyDomain(),
  unknown: true,
});

export const propertyKeyDomainValueId = (value: number | string): string =>
  `${typeof value === "number" ? "number" : "string"}\0${String(value)}`;

function valueKind(id: string): "number" | "string" {
  return id.startsWith("number\0") ? "number" : "string";
}

export function propertyKeyDomainValueText(id: string): string {
  return id.slice(id.indexOf("\0") + 1);
}

export function propertyKeyDomainConcreteValues(
  domain: PropertyKeyDomain,
): readonly (number | string)[] {
  return [...domain.values].map((id) => {
    const text = propertyKeyDomainValueText(id);
    return valueKind(id) === "number" ? Number(text) : text;
  });
}

export function propertyKeyDomainFromValue(value: number | string): PropertyKeyDomain {
  return {
    ...emptyPropertyKeyDomain(),
    values: new Set([propertyKeyDomainValueId(value)]),
  };
}

export const anyStringInterpolationPropertyKeyPattern = (): PropertyKeyPattern => ({
  kind: "any-string-interpolation",
});

export const literalInterpolationPropertyKeyPattern = (value: string): PropertyKeyPattern => ({
  kind: "literal-interpolation",
  value,
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
  if (
    left.kind === "any-string-interpolation" ||
    left.kind === "number-interpolation" ||
    left.kind === "bigint-interpolation"
  ) {
    return true;
  }
  if (left.kind === "literal-interpolation" && right.kind === "literal-interpolation") {
    return left.value === right.value;
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
): PropertyKeyPattern | null {
  const unique = uniquePatterns(
    patterns.flatMap((pattern) => (pattern.kind === "union" ? pattern.patterns : [pattern])),
  );
  if (unique.some((pattern) => pattern.kind === "any-string-interpolation")) {
    return anyStringInterpolationPropertyKeyPattern();
  }
  const [first, ...rest] = unique;
  if (first === undefined) return null;
  return rest.length === 0 ? first : { kind: "union", patterns: [first, ...rest] };
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
): boolean {
  const offsetsPerInterpolation = value.length + 1;
  const matchesByState = new Map<number, boolean>();
  const matchesFrom = (interpolationIndex: number, offset: number): boolean => {
    const state = interpolationIndex * offsetsPerInterpolation + offset;
    const cached = matchesByState.get(state);
    if (cached !== undefined) return cached;
    const quasi = pattern.quasis[interpolationIndex] ?? "";
    if (!value.startsWith(quasi, offset)) {
      matchesByState.set(state, false);
      return false;
    }
    const interpolationStart = offset + quasi.length;
    const interpolation = pattern.interpolations[interpolationIndex];
    if (interpolation === undefined) {
      const matches = interpolationStart === value.length;
      matchesByState.set(state, matches);
      return matches;
    }
    for (
      let interpolationEnd = interpolationStart;
      interpolationEnd <= value.length;
      interpolationEnd += 1
    ) {
      if (!patternMatches(interpolation, value.slice(interpolationStart, interpolationEnd)))
        continue;
      if (matchesFrom(interpolationIndex + 1, interpolationEnd)) {
        matchesByState.set(state, true);
        return true;
      }
    }
    matchesByState.set(state, false);
    return false;
  };
  return matchesFrom(0, 0);
}

function patternMatches(pattern: PropertyKeyPattern, value: string): boolean {
  if (pattern.kind === "number-interpolation") {
    return value !== "" && Number.isFinite(Number(value));
  }
  if (pattern.kind === "bigint-interpolation") {
    return /^-?(?:0|[1-9]\d*|0[xX][\dA-Fa-f]+|0[bB][01]+|0[oO][0-7]+)$/u.test(value);
  }
  if (pattern.kind === "any-string-interpolation") return true;
  if (pattern.kind === "literal-interpolation") return value === pattern.value;
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
  if (domains.some((domain) => domain.unknown)) return unknownPropertyKeyDomain();
  return {
    numbers: domains.some((domain) => domain.numbers),
    patterns: uniquePatterns(domains.flatMap((domain) => domain.patterns)),
    strings: domains.some((domain) => domain.strings),
    symbols: domains.some((domain) => domain.symbols),
    unknown: false,
    uniqueSymbols: new Set(domains.flatMap((domain) => [...domain.uniqueSymbols])),
    values: new Set(domains.flatMap((domain) => [...domain.values])),
  };
}

export function propertyKeyDomainIsBroad(domain: PropertyKeyDomain): boolean {
  return domain.numbers || domain.patterns.length > 0 || domain.strings || domain.symbols;
}

export function propertyKeyDomainAtomicDomains(
  domain: PropertyKeyDomain,
): readonly PropertyKeyDomain[] {
  const atoms: PropertyKeyDomain[] = [];
  const atom = (fields: Partial<PropertyKeyDomain>): void => {
    atoms.push({ ...emptyPropertyKeyDomain(), ...fields });
  };
  if (domain.numbers) atom({ numbers: true });
  if (domain.strings) atom({ strings: true });
  if (domain.symbols) atom({ symbols: true });
  for (const pattern of domain.patterns) atom({ patterns: [pattern] });
  for (const identity of domain.uniqueSymbols) atom({ uniqueSymbols: new Set([identity]) });
  for (const value of domain.values) atom({ values: new Set([value]) });
  return atoms;
}

type TemplatePropertyKeyPattern = Extract<PropertyKeyPattern, { kind: "template" }>;

function normalizeTemplatePattern(pattern: TemplatePropertyKeyPattern): TemplatePropertyKeyPattern {
  const quasis: string[] = [pattern.quasis[0] ?? ""];
  const interpolations: PropertyKeyPattern[] = [];
  for (const [index, interpolation] of pattern.interpolations.entries()) {
    const nextQuasi = pattern.quasis[index + 1] ?? "";
    if (interpolation.kind === "literal-interpolation") {
      quasis[quasis.length - 1] = `${quasis.at(-1) ?? ""}${interpolation.value}${nextQuasi}`;
      continue;
    }
    interpolations.push(interpolation);
    quasis.push(nextQuasi);
  }
  return { interpolations, kind: "template", quasis };
}

function findQuasiFragment(
  quasis: readonly string[],
  fragment: string,
  startQuasi: number,
  startOffset: number,
): readonly [quasi: number, offset: number] | null {
  for (let quasi = startQuasi; quasi < quasis.length; quasi += 1) {
    const value = quasis[quasi] ?? "";
    const offset = value.indexOf(fragment, quasi === startQuasi ? startOffset : 0);
    if (offset >= 0) return [quasi, offset + fragment.length];
  }
  return null;
}

function stringWildcardTemplateIncludes(
  container: TemplatePropertyKeyPattern,
  candidate: TemplatePropertyKeyPattern,
): boolean {
  if (!container.interpolations.every(({ kind }) => kind === "any-string-interpolation")) {
    return false;
  }
  const firstContainerQuasi = container.quasis[0] ?? "";
  const firstCandidateQuasi = candidate.quasis[0] ?? "";
  const lastContainerQuasi = container.quasis.at(-1) ?? "";
  const lastCandidateQuasi = candidate.quasis.at(-1) ?? "";
  if (!firstCandidateQuasi.startsWith(firstContainerQuasi)) return false;
  if (!lastCandidateQuasi.endsWith(lastContainerQuasi)) return false;

  let quasi = 0;
  let offset = firstContainerQuasi.length;
  for (const fragment of container.quasis.slice(1, -1)) {
    const match = findQuasiFragment(candidate.quasis, fragment, quasi, offset);
    if (match === null) return false;
    [quasi, offset] = match;
  }
  const lastQuasi = candidate.quasis.length - 1;
  const suffixStart = lastCandidateQuasi.length - lastContainerQuasi.length;
  return quasi < lastQuasi || (quasi === lastQuasi && offset <= suffixStart);
}

function patternIncludes(container: PropertyKeyPattern, candidate: PropertyKeyPattern): boolean {
  if (patternsEqual(container, candidate)) return true;
  if (container.kind === "any-string-interpolation") return true;
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
  if (
    (container.kind === "number-interpolation" || container.kind === "bigint-interpolation") &&
    candidate.kind === "literal-interpolation"
  ) {
    return patternMatches(container, candidate.value);
  }
  if (container.kind === "template" && candidate.kind === "template") {
    const normalizedContainer = normalizeTemplatePattern(container);
    const normalizedCandidate = normalizeTemplatePattern(candidate);
    const aligned =
      normalizedContainer.quasis.length === normalizedCandidate.quasis.length &&
      normalizedContainer.quasis.every(
        (quasi, index) => quasi === normalizedCandidate.quasis[index],
      ) &&
      normalizedContainer.interpolations.length === normalizedCandidate.interpolations.length &&
      normalizedContainer.interpolations.every((interpolation, index) => {
        const candidateInterpolation = normalizedCandidate.interpolations[index];
        return (
          candidateInterpolation !== undefined &&
          patternIncludes(interpolation, candidateInterpolation)
        );
      });
    return aligned || stringWildcardTemplateIncludes(normalizedContainer, normalizedCandidate);
  }
  return false;
}

export function propertyKeyDomainIncludes(
  domain: PropertyKeyDomain,
  candidate: PropertyKeyDomain,
): boolean {
  if (domain.unknown || candidate.unknown) return false;
  if (candidate.numbers && !domain.numbers && !domain.strings) return false;
  if (candidate.strings && !domain.strings) return false;
  if (candidate.symbols && !domain.symbols) return false;
  if (
    !domain.symbols &&
    [...candidate.uniqueSymbols].some((identity) => !domain.uniqueSymbols.has(identity))
  ) {
    return false;
  }
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

export function propertyKeyDomainIsExact(domain: PropertyKeyDomain): boolean {
  return (
    !domain.numbers &&
    !domain.strings &&
    !domain.symbols &&
    !domain.unknown &&
    domain.patterns.length === 0 &&
    domain.uniqueSymbols.size + domain.values.size === 1
  );
}

export function propertyKeyDomainIsEmpty(domain: PropertyKeyDomain): boolean {
  return (
    !domain.numbers &&
    !domain.strings &&
    !domain.symbols &&
    !domain.unknown &&
    domain.patterns.length === 0 &&
    domain.uniqueSymbols.size === 0 &&
    domain.values.size === 0
  );
}

function intersectionPattern(
  left: PropertyKeyPattern,
  right: PropertyKeyPattern,
): PropertyKeyPattern {
  return patternsEqual(left, right) ? left : { kind: "intersection", patterns: [left, right] };
}

export function intersectPropertyKeyDomains(
  left: PropertyKeyDomain,
  right: PropertyKeyDomain,
): PropertyKeyDomain {
  if (left.unknown) return right;
  if (right.unknown) return left;
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
  const uniqueSymbols = new Set<string>();
  for (const identity of left.uniqueSymbols) {
    if (right.symbols || right.uniqueSymbols.has(identity)) uniqueSymbols.add(identity);
  }
  for (const identity of right.uniqueSymbols) {
    if (left.symbols || left.uniqueSymbols.has(identity)) uniqueSymbols.add(identity);
  }
  return {
    numbers: left.numbers && right.numbers,
    patterns: uniquePatterns(patterns),
    strings: left.strings && right.strings,
    symbols: left.symbols && right.symbols,
    unknown: false,
    uniqueSymbols,
    values,
  };
}

export function subtractPropertyKeyDomains(
  source: PropertyKeyDomain,
  excluded: PropertyKeyDomain,
): PropertyKeyDomain {
  if (excluded.unknown) return emptyPropertyKeyDomain();
  if (source.unknown) return source;
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
    unknown: false,
    uniqueSymbols: new Set(
      [...source.uniqueSymbols].filter(
        (identity) => !excluded.symbols && !excluded.uniqueSymbols.has(identity),
      ),
    ),
    values: new Set([...source.values].filter((value) => !acceptsDomainValue(excluded, value))),
  };
}
