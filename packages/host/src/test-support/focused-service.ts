/** Check the methods supplied by a focused test service without claiming omitted methods exist. */
export const createFocusedTestService =
  <Service extends object>() =>
  <Implementation extends Partial<Service>>(service: Implementation): Implementation =>
    service;
