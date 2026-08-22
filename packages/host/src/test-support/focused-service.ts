/** Build a focused test service whose supplied members still match the production contract. */
export const createFocusedTestService = <Service>(service: Partial<Service>): Service => {
  // SAFETY: focused tests exercise only the supplied service members; Partial verifies each member.
  return service as Service;
};

/** Pass malformed test data through a static contract without weakening production types. */
interface InvalidFixtureInput extends Record<never, never> {}

interface InvalidFixtureArray extends ReadonlyArray<InvalidFixtureInput> {}

export const createInvalidFixture = <Value>(
  value: InvalidFixtureInput | InvalidFixtureArray,
): Value => {
  // SAFETY: boundary tests use this helper only to verify runtime validation of malformed data.
  return value as Value;
};
