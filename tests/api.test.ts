import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/repositories/database.js';
import { loadEnv } from '../src/config/env.js';
import { loadSigningKeys, verifyLicense } from '../src/utils/signature.js';
import { hashSecret } from '../src/utils/secrets.js';
import { DAY_MS } from '../src/services/license-policy.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/middleware/auth.js';

if (process.env.CENTRAL_ISOLATED_TEST !== 'true' || process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL?.endsWith('/central_test')) throw new Error('Run npm test: isolated database required');
const env = loadEnv();
const db = createDatabase(env.DATABASE_URL);
const { privateKey, publicKey } = loadSigningKeys(env.LICENSE_PRIVATE_KEY_PATH, env.LICENSE_PUBLIC_KEY_PATH);
const ctx = { db, env, privateKey };
const app = createApp(ctx);
const password = randomBytes(24).toString('base64url');
const email = `${randomUUID()}@example.test`;
let adminId: string;
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
let clientId: string;
let productId: string;
let installationUuid: string;
let externalId: string;
let secret: string;
let licenseId: string;
const validate = (override = {}) => request(app).post('/api/v1/license/validate').send({ installationId: externalId, installationSecret: secret, ...override });
const action = (name: string, body = {}) => request(app).post(`/api/v1/licenses/${licenseId}/${name}`).set(auth()).send(body);

beforeAll(async () => {
  const admin = await db.admin.create({ data: { name: 'Test Administrator', email, passwordHash: await bcrypt.hash(password, 12) } });
  adminId = admin.id;
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  token = response.body.token;
});
afterAll(async () => { await db.$disconnect(); });
beforeEach(async () => {
  const client = await db.client.create({ data: { name: 'Prefeitura Municipal de Banabuiú' } });
  const product = await db.product.create({ data: { name: 'Sistema de Atendimento', code: `produto-${randomUUID()}` } });
  clientId = client.id;
  productId = product.id;
  externalId = `BANABUIU-${randomUUID()}`;
  secret = randomBytes(48).toString('base64url');
  const installation = await db.installation.create({ data: { name: 'Servidor', clientId, productId, installationId: externalId, secretHash: hashSecret(secret) } });
  installationUuid = installation.id;
  const now = new Date();
  const license = await db.license.create({ data: { installationId: installationUuid, startsAt: new Date(now.getTime() - DAY_MS), expiresAt: new Date(now.getTime() + 30 * DAY_MS), graceUntil: new Date(now.getTime() + 35 * DAY_MS) } });
  licenseId = license.id;
});

describe('Admin authentication', () => {
  it('valid login returns JWT without password/hash', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ email: email.toUpperCase(), password });
    expect(response.status).toBe(200);
    expect(jwt.verify(response.body.token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE })).toMatchObject({ sub: adminId });
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(response.body.passwordHash).toBeUndefined();
  });
  it('wrong password and unknown email use same rejection', async () => {
    const wrong = await request(app).post('/api/v1/auth/login').send({ email, password: randomUUID() });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: 'unknown@example.test', password });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });
  it.each(['clients', 'products', 'installations', 'licenses', 'events'])('protects /%s without JWT', async route => expect((await request(app).get(`/api/v1/${route}`)).status).toBe(401));
  it('rejects invalid, expired, wrong audience and wrong algorithm JWT', async () => {
    const tokens = [
      'invalid',
      jwt.sign({}, env.JWT_SECRET, { subject: adminId, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: -1 }),
      jwt.sign({}, env.JWT_SECRET, { subject: adminId, issuer: JWT_ISSUER, audience: 'other', expiresIn: 100 }),
      jwt.sign({}, env.JWT_SECRET, { subject: adminId, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS384', expiresIn: 100 }),
    ];
    for (const value of tokens) expect((await request(app).get('/api/v1/clients').set('Authorization', `Bearer ${value}`)).status).toBe(401);
  });
  it('immediately rejects disabled admin with existing token', async () => {
    await db.admin.update({ where: { id: adminId }, data: { active: false } });
    try { expect((await request(app).get('/api/v1/clients').set(auth())).status).toBe(401); }
    finally { await db.admin.update({ where: { id: adminId }, data: { active: true } }); }
  });
});

describe('CRUD and audit', () => {
  it('creates, reads, lists and updates client using Zod', async () => {
    const create = await request(app).post('/api/v1/clients').set(auth()).send({ name: 'Prefeitura Municipal de Banabuiú', email: 'contato@example.test' });
    expect(create.status).toBe(201);
    expect((await request(app).get(`/api/v1/clients/${create.body.data.id}`).set(auth())).body.data.name).toBe('Prefeitura Municipal de Banabuiú');
    expect((await request(app).patch(`/api/v1/clients/${create.body.data.id}`).set(auth()).send({ active: false })).body.data.active).toBe(false);
    expect((await request(app).get('/api/v1/clients?limit=1').set(auth())).body.data).toHaveLength(1);
    expect((await request(app).post('/api/v1/clients').set(auth()).send({ name: '' })).status).toBe(400);
  });
  it('creates, reads, lists and updates product; rejects duplicate code', async () => {
    const input = { name: 'Sistema de Atendimento', code: `sistema-atendimento-${randomUUID()}` };
    const response = await request(app).post('/api/v1/products').set(auth()).send(input);
    expect(response.status).toBe(201);
    expect((await request(app).get(`/api/v1/products/${response.body.data.id}`).set(auth())).body.data.code).toBe(input.code);
    expect((await request(app).patch(`/api/v1/products/${response.body.data.id}`).set(auth()).send({ name: 'Atendimento' })).body.data.name).toBe('Atendimento');
    expect((await request(app).get('/api/v1/products').set(auth())).status).toBe(200);
    expect((await request(app).post('/api/v1/products').set(auth()).send(input)).status).toBe(409);
  });
  it('creates installation; secret is returned once, never stored or exposed on read/list/patch/events', async () => {
    const response = await request(app).post('/api/v1/installations').set(auth()).send({ clientId, productId, name: 'Servidor', installationId: 'BANABUIU-001' });
    expect(response.status).toBe(201);
    const stored = await db.installation.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(response.body.installationId).toBe('BANABUIU-001');
    expect(response.body.installationSecret).toHaveLength(64);
    expect(stored.secretHash).toBe(hashSecret(response.body.installationSecret));
    expect(stored.secretHash).not.toBe(response.body.installationSecret);
    expect(response.body.data.secretHash).toBeUndefined();
    for (const route of [`/api/v1/installations/${stored.id}`, '/api/v1/installations', `/api/v1/events?installationId=${stored.id}`]) {
      const read = await request(app).get(route).set(auth());
      expect(JSON.stringify(read.body)).not.toContain(response.body.installationSecret);
      expect(JSON.stringify(read.body)).not.toContain(stored.secretHash);
    }
    const patch = await request(app).patch(`/api/v1/installations/${stored.id}`).set(auth()).send({ active: false });
    expect(patch.body.data.active).toBe(false);
    expect(patch.body.data.secretHash).toBeUndefined();
    expect((await db.licenseEvent.findFirstOrThrow({ where: { installationId: stored.id } })).type).toBe('INSTALLATION_CREATED');
  });
  it('generates installation ID when omitted; validates relation IDs', async () => {
    const response = await request(app).post('/api/v1/installations').set(auth()).send({ clientId, productId, name: 'Servidor' });
    expect(response.status).toBe(201);
    expect(response.body.installationId).toMatch(/^INST-/);
    expect((await request(app).post('/api/v1/installations').set(auth()).send({ clientId: randomUUID(), productId, name: 'Invalid' })).status).toBe(400);
  });
  it('creates one ACTIVE license with correct dates and audit; duplicate is rejected', async () => {
    const installation = await db.installation.create({ data: { clientId, productId, name: 'Outra', installationId: `INST-${randomUUID()}`, secretHash: hashSecret(secret) } });
    const response = await request(app).post('/api/v1/licenses').set(auth()).send({ installationId: installation.id, days: 30, graceDays: 5 });
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('ACTIVE');
    expect(new Date(response.body.data.expiresAt).getTime() - new Date(response.body.data.startsAt).getTime()).toBe(30 * DAY_MS);
    expect(new Date(response.body.data.graceUntil).getTime() - new Date(response.body.data.expiresAt).getTime()).toBe(5 * DAY_MS);
    expect((await request(app).get(`/api/v1/licenses/${response.body.data.id}`).set(auth())).status).toBe(200);
    expect((await request(app).get('/api/v1/licenses').set(auth())).status).toBe(200);
    expect((await request(app).post('/api/v1/licenses').set(auth()).send({ installationId: installation.id, days: 30 })).status).toBe(409);
    expect((await db.licenseEvent.findFirstOrThrow({ where: { licenseId: response.body.data.id } })).type).toBe('LICENSE_CREATED');
  });
  it('events support pagination, type, installation and time filters', async () => {
    await validate();
    const response = await request(app).get(`/api/v1/events?installationId=${installationUuid}&type=LICENSE_VALIDATED&limit=1&from=2020-01-01T00:00:00Z`).set(auth());
    expect(response.status).toBe(200);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.data[0].metadata.status).toBe('ACTIVE');
    expect((await request(app).get('/api/v1/events?limit=1000').set(auth())).status).toBe(400);
  });
});

describe('Public validation with real PostgreSQL', () => {
  it('ACTIVE response is signed, minimal, and updates last validation', async () => {
    const response = await validate();
    expect(response.status).toBe(200);
    expect(response.body.license.status).toBe('ACTIVE');
    expect(Object.keys(response.body.license).sort()).toEqual(['expiresAt', 'graceUntil', 'installationId', 'issuedAt', 'product', 'status']);
    expect(verifyLicense(response.body.license, response.body.signature, publicKey)).toBe(true);
    expect(verifyLicense({ ...response.body.license, status: 'REVOKED' }, response.body.signature, publicKey)).toBe(false);
    expect((await db.installation.findUniqueOrThrow({ where: { id: installationUuid } })).lastValidationAt?.toISOString()).toBe(response.body.license.issuedAt);
  });
  it('GRACE when expiry passed', async () => {
    const now = Date.now();
    await db.license.update({ where: { id: licenseId }, data: { expiresAt: new Date(now - DAY_MS), graceUntil: new Date(now + DAY_MS) } });
    expect((await validate()).body.license.status).toBe('GRACE');
  });
  it('EXPIRED after grace', async () => {
    const now = Date.now();
    await db.license.update({ where: { id: licenseId }, data: { startsAt: new Date(now - 10 * DAY_MS), expiresAt: new Date(now - 5 * DAY_MS), graceUntil: new Date(now - DAY_MS) } });
    expect((await validate()).body.license.status).toBe('EXPIRED');
  });
  it('SUSPENDED takes priority over dates', async () => {
    expect((await action('suspend', { reason: 'Contrato suspenso' })).status).toBe(200);
    await db.license.update({ where: { id: licenseId }, data: { expiresAt: new Date(Date.now() - 5 * DAY_MS), graceUntil: new Date(Date.now() - DAY_MS) } });
    expect((await validate()).body.license.status).toBe('SUSPENDED');
  });
  it('REVOKED is permanent and takes priority; no data is removed', async () => {
    expect((await action('revoke', { reason: 'Contrato encerrado' })).status).toBe(200);
    await db.installation.update({ where: { id: installationUuid }, data: { active: false } });
    expect((await validate()).body.license.status).toBe('REVOKED');
    for (const name of ['renew', 'suspend', 'reactivate', 'revoke']) expect((await action(name, name === 'renew' ? { days: 30 } : {})).status).toBe(409);
    expect(await db.license.count({ where: { id: licenseId } })).toBe(1);
    expect(await db.licenseEvent.count({ where: { licenseId, type: 'LICENSE_REVOKED' } })).toBe(1);
  });
  it.each(['installation', 'client', 'product'] as const)('inactive %s returns signed SUSPENDED', async entity => {
    if (entity === 'installation') await db.installation.update({ where: { id: installationUuid }, data: { active: false } });
    if (entity === 'client') await db.client.update({ where: { id: clientId }, data: { active: false } });
    if (entity === 'product') await db.product.update({ where: { id: productId }, data: { active: false } });
    const response = await validate();
    expect(response.body.license.status).toBe('SUSPENDED');
    expect(verifyLicense(response.body.license, response.body.signature, publicKey)).toBe(true);
  });
  it('wrong secret and nonexistent installation have identical 401 response', async () => {
    const wrong = await validate({ installationSecret: randomUUID() });
    const unknown = await validate({ installationId: 'DOES-NOT-EXIST' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ success: false, error: 'INVALID_INSTALLATION_CREDENTIALS' });
    expect(unknown.body).toEqual(wrong.body);
    expect((await db.installation.findUniqueOrThrow({ where: { id: installationUuid } })).lastValidationAt).toBeNull();
  });
  it('cannot supply client date or status', async () => {
    expect((await validate({ status: 'ACTIVE', issuedAt: '2030-01-01T00:00:00Z' })).status).toBe(400);
  });
  it('missing license returns explicit error after credential validation', async () => {
    await db.license.delete({ where: { id: licenseId } });
    const response = await validate();
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('LICENSE_NOT_FOUND');
  });
  it('deduplicates consecutive/concurrent validation events and records changes plus 24h heartbeat', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => validate()));
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(await db.licenseEvent.count({ where: { installationId: installationUuid, type: 'LICENSE_VALIDATED' } })).toBe(1);
    await action('suspend');
    await validate();
    expect(await db.licenseEvent.count({ where: { installationId: installationUuid, type: 'LICENSE_VALIDATED' } })).toBe(2);
    await db.installation.update({ where: { id: installationUuid }, data: { lastValidationEventAt: new Date(Date.now() - 2 * DAY_MS) } });
    await validate();
    expect(await db.licenseEvent.count({ where: { installationId: installationUuid, type: 'LICENSE_VALIDATED' } })).toBe(3);
  });
});

describe('Lifecycle', () => {
  it('renews from valid expiry and records audit', async () => {
    const previous = await db.license.findUniqueOrThrow({ where: { id: licenseId } });
    const response = await action('renew', { days: 30, graceDays: 5 });
    expect(response.status).toBe(200);
    expect(new Date(response.body.data.expiresAt).getTime()).toBe(previous.expiresAt.getTime() + 30 * DAY_MS);
    expect(new Date(response.body.data.graceUntil).getTime()).toBe(previous.expiresAt.getTime() + 35 * DAY_MS);
    expect(await db.licenseEvent.count({ where: { licenseId, type: 'LICENSE_RENEWED' } })).toBe(1);
  });
  it('renews expired license from server now', async () => {
    await db.license.update({ where: { id: licenseId }, data: { startsAt: new Date(Date.now() - 100 * DAY_MS), expiresAt: new Date(Date.now() - 60 * DAY_MS), graceUntil: new Date(Date.now() - 55 * DAY_MS) } });
    const before = Date.now();
    const response = await action('renew', { days: 30, graceDays: 0 });
    const after = Date.now();
    expect(response.status).toBe(200);
    expect(new Date(response.body.data.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(new Date(response.body.data.expiresAt).getTime()).toBeLessThanOrEqual(after + 30 * DAY_MS);
    expect(response.body.data.expiresAt).toBe(response.body.data.graceUntil);
  });
  it('concurrent renewals both apply without lost update', async () => {
    const previous = await db.license.findUniqueOrThrow({ where: { id: licenseId } });
    const responses = await Promise.all([action('renew', { days: 30, graceDays: 5 }), action('renew', { days: 30, graceDays: 5 })]);
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect((await db.license.findUniqueOrThrow({ where: { id: licenseId } })).expiresAt.getTime()).toBe(previous.expiresAt.getTime() + 60 * DAY_MS);
  });
  it('renewing suspended license does not implicitly reactivate', async () => {
    await action('suspend');
    expect((await action('renew', { days: 30 })).body.data.status).toBe('SUSPENDED');
  });
  it('reactivates without deleting suspension history or changing dates', async () => {
    await action('suspend');
    const previous = await db.license.findUniqueOrThrow({ where: { id: licenseId } });
    const response = await action('reactivate');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ACTIVE');
    expect(response.body.data.expiresAt).toBe(previous.expiresAt.toISOString());
    expect((await validate()).body.license.status).toBe('ACTIVE');
    const events = await db.licenseEvent.findMany({ where: { licenseId }, orderBy: { createdAt: 'asc' } });
    expect(events.map(e => e.type)).toContain('LICENSE_SUSPENDED');
    expect(events.map(e => e.type)).toContain('LICENSE_REACTIVATED');
  });
  it('rejects invalid days and unknown UUID routes without internal errors', async () => {
    expect((await action('renew', { days: 0 })).status).toBe(400);
    expect((await request(app).get('/api/v1/licenses/not-uuid').set(auth())).status).toBe(400);
    expect((await request(app).get(`/api/v1/licenses/${randomUUID()}`).set(auth())).status).toBe(404);
  });
});

describe('Operational security', () => {
  it('health is minimal with Helmet headers and no-store', async () => {
    const response = await request(app).get('/health');
    expect(response.body).toEqual({ success: true, service: 'central-licencas' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('rejects malformed and oversized JSON', async () => {
    expect((await request(app).post('/api/v1/license/validate').set('Content-Type', 'application/json').send('{')).status).toBe(400);
    expect((await validate({ installationSecret: 'x'.repeat(20000) })).status).toBe(413);
  });
  it('validation has own rate limit; X-Forwarded-For does not bypass it', async () => {
    const limited = createApp({ ...ctx, env: { ...env, VALIDATION_RATE_LIMIT_MAX: 1 } });
    expect((await request(limited).post('/api/v1/license/validate').send({ installationId: externalId, installationSecret: secret })).status).toBe(200);
    expect((await request(limited).post('/api/v1/license/validate').set('X-Forwarded-For', '192.0.2.1').send({ installationId: externalId, installationSecret: secret })).status).toBe(429);
  });
  it('login has its own rate limit', async () => {
    const limited = createApp({ ...ctx, env: { ...env, LOGIN_RATE_LIMIT_MAX: 1 } });
    expect((await request(limited).post('/api/v1/auth/login').send({ email, password })).status).toBe(200);
    expect((await request(limited).post('/api/v1/auth/login').send({ email, password })).status).toBe(429);
  });
});
