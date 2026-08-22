/** Build a focused test service whose supplied members still match the production contract. */
export const createFocusedTestService = <Service extends object>(
  service: Partial<Service>,
): Service => {
  const guardedService = new Proxy(service, {
    get(target, property) {
      if (!(property in target)) {
        throw new Error(`Focused test service does not implement '${String(property)}'.`);
      }
      // SAFETY: The property-existence check proves this key is present on the partial service.
      return target[property as keyof Service];
    },
  });
  // SAFETY: The proxy rejects every read of an omitted service member, while Partial checks each supplied member.
  return guardedService as Service;
};

/** Pass malformed test data through a static contract without weakening production types. */
export const createInvalidFixture = <
  Value,
  Source extends object | readonly object[] = object | readonly object[],
>(
  value: Source,
): Value => {
  // SAFETY: boundary tests use this helper only to verify runtime validation of malformed object payloads.
  return value as Source & Value;
};
