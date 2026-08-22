interface InvalidFixtureInput extends Record<never, never> {}

export const createInvalidFixture = <Value>(value: InvalidFixtureInput): Value => {
  // SAFETY: boundary tests use this helper only to pass malformed runtime data through a static type gate.
  return value as Value;
};
