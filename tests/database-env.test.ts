import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { databaseUrlScheme, loadEnv } from '../src/config/env.js';
import { logStartupConfiguration } from '../src/config/startup.js';

afterEach(() => vi.unstubAllEnvs());
const username = randomBytes(12).toString('hex');
const password = randomBytes(24).toString('hex');
const host = `${randomBytes(8).toString('hex')}.example.test`;
const database = randomBytes(12).toString('hex');
const url = (scheme: string) => `${scheme}://${username}:${password}@${host}:5432/${database}`;

describe('DATABASE_URL environment validation', () => {
  it.each(['postgresql', 'postgres'] as const)('accepts a valid %s connection URL', scheme => {
    vi.stubEnv('DATABASE_URL', url(scheme));
    const env = loadEnv();
    // Boolean assertions prevent credentials from being printed on failure.
    expect(env.DATABASE_URL === url(scheme)).toBe(true);
    expect(databaseUrlScheme(env.DATABASE_URL)).toBe(scheme);
  });
  it.each([
    ['HTTP URL', (): string => url('https')],
    ['empty string', (): string => ''],
    ['unresolved Railway reference', (): string => '${{Postgres.DATABASE_URL}}'],
    ['opaque PostgreSQL string', (): string => 'postgres:invalid'],
    ['missing host', (): string => 'postgresql:///database'],
    ['invalid port', (): string => `postgresql://${username}:${password}@${host}:not-a-port/${database}`],
    ['whitespace', (): string => ` ${url('postgresql')}`],
    ['malformed percent encoding', (): string => `postgresql://${username}:bad%ZZ@${host}:5432/${database}`],
  ] as const)('rejects %s without exposing input', (_label, input) => {
    vi.stubEnv('DATABASE_URL', input());
    expect(() => loadEnv()).toThrow('Invalid environment fields: DATABASE_URL');
    expect(databaseUrlScheme(input())).toBe('invalid');
  });
  it('allows percent-encoded credentials, private Railway-style hosts and PostgreSQL query parameters', () => {
    const value = `postgresql://${username}:${encodeURIComponent(`${password}@:/?#%`)}@postgres.railway.internal:5432/${database}?sslmode=require&connection_limit=5`;
    vi.stubEnv('DATABASE_URL', value);
    expect(loadEnv().DATABASE_URL === value).toBe(true);
    expect(databaseUrlScheme(value)).toBe('postgresql');
  });
  it('allows the default PostgreSQL port and IPv6 URLs', () => {
    for (const value of [`postgres://${username}:${password}@${host}/${database}`, `postgresql://${username}:${password}@[::1]:5432/${database}`]) {
      vi.stubEnv('DATABASE_URL', value);
      expect(loadEnv().DATABASE_URL === value).toBe(true);
    }
  });
});

describe('Safe DATABASE_URL scheme logging', () => {
  it.each(['postgresql', 'postgres', 'https'] as const)('logs only the allowlisted label for %s', scheme => {
    const value = url(scheme);
    const logs: string[] = [];
    logStartupConfiguration({ NODE_ENV: 'production', DATABASE_URL: value }, line => logs.push(line));
    expect(logs.includes(`[STARTUP] DATABASE_URL scheme: ${scheme === 'https' ? 'invalid' : scheme}`)).toBe(true);
    expect([value, username, password, host, database, '5432'].some(secret => logs.some(line => line.includes(secret)))).toBe(false);
  });
  it.each(['', '${{Postgres.DATABASE_URL}}', 'postgresql://\n[INJECTED]'] as const)('logs invalid without echoing malformed input (case %#)', value => {
    const logs: string[] = [];
    logStartupConfiguration({ DATABASE_URL: value }, line => logs.push(line));
    expect(logs.includes('[STARTUP] DATABASE_URL scheme: invalid')).toBe(true);
    expect(logs.some(line => line.includes('Postgres.DATABASE_URL') || line.includes('[INJECTED]'))).toBe(false);
  });
});
