import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const newSecret = () => randomBytes(48).toString('base64url');
export const hashSecret = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex');
const missingHash = hashSecret(newSecret());
export function matchesSecret(secret: string, storedHash?: string): boolean {
  const expected = Buffer.from(storedHash ?? missingHash, 'hex');
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
  return valid && storedHash !== undefined;
}
