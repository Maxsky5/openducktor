export type PropertyKeyDomain = {
  readonly numbers: boolean;
  readonly patterns: ReadonlySet<string>;
  readonly strings: boolean;
  readonly symbols: boolean;
  readonly values: ReadonlySet<string>;
};

export const emptyPropertyKeyDomain = (): PropertyKeyDomain => ({
  numbers: false,
  patterns: new Set(),
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

function patternMatches(pattern: string, value: string): boolean {
  return new RegExp(pattern, "u").test(value);
}

function acceptsDomainValue(domain: PropertyKeyDomain, id: string): boolean {
  if (domain.values.has(id)) return true;
  if (valueKind(id) === "number") return domain.numbers;
  return (
    domain.strings ||
    [...domain.patterns].some((pattern) => patternMatches(pattern, propertyKeyDomainValueText(id)))
  );
}

function isCanonicalNumericPropertyName(value: string): boolean {
  if (value === "0") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(numeric) === value;
}

function acceptsConcreteValue(domain: PropertyKeyDomain, value: number | string): boolean {
  const text = String(value);
  if (domain.strings || domain.values.has(propertyKeyDomainValueId(value))) return true;
  if ([...domain.patterns].some((pattern) => patternMatches(pattern, text))) return true;
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
    patterns: new Set(domains.flatMap((domain) => [...domain.patterns])),
    strings: domains.some((domain) => domain.strings),
    symbols: domains.some((domain) => domain.symbols),
    values: new Set(domains.flatMap((domain) => [...domain.values])),
  };
}

export function propertyKeyDomainIsBroad(domain: PropertyKeyDomain): boolean {
  return domain.numbers || domain.patterns.size > 0 || domain.strings || domain.symbols;
}

export function propertyKeyDomainIncludes(
  domain: PropertyKeyDomain,
  candidate: PropertyKeyDomain,
): boolean {
  if (candidate.numbers && !domain.numbers && !domain.strings) return false;
  if (candidate.strings && !domain.strings) return false;
  if (candidate.symbols && !domain.symbols) return false;
  if ([...candidate.patterns].some((pattern) => !domain.strings && !domain.patterns.has(pattern))) {
    return false;
  }
  return [...candidate.values].every((value) => acceptsDomainValue(domain, value));
}

export function propertyKeyDomainMatches(
  domain: PropertyKeyDomain,
  value: number | string,
): boolean {
  return acceptsConcreteValue(domain, value);
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
  const patterns = new Set<string>();
  if (left.strings) for (const pattern of right.patterns) patterns.add(pattern);
  if (right.strings) for (const pattern of left.patterns) patterns.add(pattern);
  for (const pattern of left.patterns) {
    if (right.patterns.has(pattern)) patterns.add(pattern);
  }
  return {
    numbers: left.numbers && right.numbers,
    patterns,
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
      ? new Set()
      : new Set([...source.patterns].filter((pattern) => !excluded.patterns.has(pattern))),
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
