import { afterEach, expect, test } from "bun:test";
import tls from "node:tls";
import { trustSystemCertificates } from "./system-trust-store";

const original = tls.getCACertificates("default");
// A private CA, as NODE_EXTRA_CA_CERTS adds it. It is in neither the bundled nor the system list.
const privateCa = [
  "-----BEGIN CERTIFICATE-----",
  "MIICujCCAaICCQC9Z38G++7cAzANBgkqhkiG9w0BAQsFADAeMRwwGgYDVQQDDBNP",
  "cGVuRHVja3RvciBUZXN0IENBMCAXDTI2MTEwMzIzNTM0M1oYDzIxMjYxMDEwMjM1",
  "MzQzWjAeMRwwGgYDVQQDDBNPcGVuRHVja3RvciBUZXN0IENBMIIBIjANBgkqhkiG",
  "9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyj0c0CYVH0+ZfdjGR9XegoEmoFTwVKlwzCtt",
  "Pk2QsCSauq425cNTir9xagLHoaLSeq0N5bM3R0OyBYjx+WCfO10rarBD9qzf6rtJ",
  "WUo1gyEl0hBRsuPAeu0X9XDPCwsorE0Ssdbd2BGhF/yLu96KG8rZxt+i6J86YnJz",
  "rJnj4tKJDt/np/SsQSBIMKsTiMX2UsWB20kyafKqDUKwyXIV6tnBy4NoYqHW+5Nd",
  "qixiQynIchh53sVihvgK3jQfyw26tsxi0EjrGHTk2VH5UlTP6oqSJt2JW1e/0skq",
  "CdAyJE8pqTkOXx6BCcHSCkZjLpQ1oGvoPPOy4TsYTO4ZxN+i5wIDAQABMA0GCSqG",
  "SIb3DQEBCwUAA4IBAQCv7KhAUUKX3Q+HJWCC9QYFI+m78KVC+atk0jNUHaKV+vy9",
  "bQ8G8+d1hSemiIXCEUySdHO5d4k1AzTJhUrypY7XFg0FYDp4I5LHJJkYTtj282oA",
  "4h0YTdd3PWAMGHQfkGTr71y5k9+DbnjWYWc66tBRp621fxwg1rCiaztVbyYodhqC",
  "46lcdKqo9IzlAQKMDaiOpo5xLKLVs8t+5iG6S3LaO40594O7BtaJazc1ieFGEImq",
  "YLZFKNUUAHUzUONYFXpIx/0CYbnoedUlRFSyDhjAAc7C0LqUli5Ng8wuI9qSb6U3",
  "l7aVSGH3NhMVc2AT4Nu0nJqEEnfiWyHCPuvjyu7j",
  "-----END CERTIFICATE-----",
].join("\n");
// The runtime can reformat a PEM certificate when it stores it, so compare the content only.
const pemBodies = (certificates: string[]) =>
  certificates.map((certificate) => certificate.replace(/\s+/gu, ""));

afterEach(() => {
  tls.setDefaultCACertificates(original);
});

test("keeps the default certificates, such as NODE_EXTRA_CA_CERTS, and adds the system ones", () => {
  tls.setDefaultCACertificates([...original, privateCa]);
  trustSystemCertificates();
  const trusted = pemBodies(tls.getCACertificates("default"));
  expect(trusted).toEqual(expect.arrayContaining(pemBodies([...original, privateCa])));
  expect(trusted).toEqual(expect.arrayContaining(pemBodies(tls.getCACertificates("system"))));
});
