export const OPENDUCKTOR_DEV_INSTANCE_ENV = "OPENDUCKTOR_DEV_INSTANCE";

declare const DEVELOPMENT_INSTANCE_ID_BRAND: unique symbol;
export type DevelopmentInstanceId = string & {
  readonly [DEVELOPMENT_INSTANCE_ID_BRAND]: true;
};

export const DEVELOPMENT_INSTANCE_ID_PATTERN = /^(browser|electron)-[a-f0-9]{12}$/u;

export const isDevelopmentInstanceId = (value: string): value is DevelopmentInstanceId =>
  DEVELOPMENT_INSTANCE_ID_PATTERN.test(value);
