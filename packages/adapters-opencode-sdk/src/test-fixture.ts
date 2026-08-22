export const createInvalidFixture = <Value extends object, Source extends object = object>(
  value: Source,
): Value => {
  // SAFETY: boundary tests use this helper only to pass malformed object payloads through a static contract.
  return value as Source & Value;
};
