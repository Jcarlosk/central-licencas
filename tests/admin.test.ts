import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createApp } from '../src/app.js';
import type { Context } from '../src/types/context.js';

const source = readFileSync(new URL('../public/admin/app.js', import.meta.url), 'utf8');
const client = { id: 'client-1', name: 'Cliente de teste', active: true };
const product = { id: 'product-1', name: 'Produto', code: 'produto', active: true };
const installation = { id: 'installation-1', clientId: client.id, productId: product.id, name: 'Servidor teste', installationId: 'INST-TESTE', active: true };
const license = { id: 'license-1', installationId: installation.id, status: 'ACTIVE', startsAt: '2020-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', graceUntil: '2099-01-06T00:00:00Z' };

async function setup(records = [license]) {
  const dom = new JSDOM('<div id="app"></div><dialog id="modal"></dialog><div id="notice"></div>', { url: 'https://central.example/admin/', runScripts: 'outside-only' });
  const w = dom.window;
  Object.assign(w, { TextEncoder });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
  const licenses = records.map(item => ({ ...item }));
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.split('?')[0]!;
    let result: Record<string, unknown>;
    if (path.endsWith('/auth/login')) result = { success: true, token };
    else if (init.method === 'POST' && path.endsWith('/installations')) result = { success: true, data: { ...installation, id: 'installation-new' }, installationId: 'INST-NOVA', installationSecret: 'ONE-TIME-SECRET' };
    else if (init.method === 'POST') {
      if (path.endsWith('/suspend')) licenses[0]!.status = 'SUSPENDED';
      if (path.endsWith('/reactivate')) licenses[0]!.status = 'ACTIVE';
      if (path.endsWith('/licenses')) licenses.push({ ...license });
      result = { success: true, data: licenses[0] };
    }
    else {
      const kind = path.split('/').at(-1)!;
      const data: Record<string, unknown[]> = { clients: [client], products: [product], installations: [installation], licenses, events: [] };
      result = { success: true, data: data[kind], pagination: { total: data[kind]!.length, page: 1, limit: 100 } };
    }
    return { ok: true, status: 200, json: async () => result };
  });
  Object.assign(w, { fetch });
  w.eval(source);
  const submit = (form: HTMLFormElement) => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 30)); };
  (w.document.querySelector('#email') as HTMLInputElement).value = 'admin@example.test';
  (w.document.querySelector('#password') as HTMLInputElement).value = 'test-password';
  submit(w.document.querySelector('#login')!); await settle();
  return { dom, w, fetch, submit, settle };
}

describe('Administrative panel', () => {
  it('serves only public panel assets and keeps API protected', async () => {
    // No database operation is needed or permitted in this serving test.
    const ctx = { env: { RATE_LIMIT_MAX: 100, LOGIN_RATE_LIMIT_MAX: 100, VALIDATION_RATE_LIMIT_MAX: 100 }, db: {} } as Context;
    const app = createApp(ctx);
    expect((await request(app).get('/')).headers.location).toBe('/admin/');
    const page = await request(app).get('/admin/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Central de Licenças');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await request(app).get('/admin/app.js')).status).toBe(200);
    expect((await request(app).get('/api/v1/clients')).status).toBe(401);
    for (const path of ['/admin/.env', '/admin/keys/license-private.pem', '/admin/src/config/env.ts']) expect((await request(app).get(path)).status).toBe(404);
  });
  it('logs in through API, searches, sends lifecycle actions and clears local session on logout', async () => {
    const { dom, w, fetch, submit, settle } = await setup();
    try {
      expect(w.document.querySelector('#title')?.textContent).toBe('Dashboard');
      expect(w.localStorage.length).toBe(0); expect(w.sessionStorage.length).toBe(0);
      (w.document.querySelector('[data-view="licenses"]') as HTMLButtonElement).click();
      const search = w.document.querySelector('#search') as HTMLInputElement;
      search.value = 'nenhum'; search.dispatchEvent(new w.Event('input'));
      expect(w.document.querySelector('#results')?.textContent).toContain('Nenhum registro');
      search.value = 'Cliente de teste'; search.dispatchEvent(new w.Event('input'));
      expect(w.document.querySelector('#results')?.textContent).toContain('Servidor teste');
      for (const action of ['suspend', 'reactivate', 'renew']) {
        (w.document.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
        submit(w.document.querySelector('#operation')!); await settle();
        expect(fetch.mock.calls.some(([url, init]) => url === `/api/v1/licenses/license-1/${action}` && init.method === 'POST')).toBe(true);
      }
      expect(fetch.mock.calls.some(([url]) => url.includes('/revoke'))).toBe(false);
      (w.document.querySelector('#logout') as HTMLButtonElement).click();
      expect(w.document.querySelector('#login')).not.toBeNull();
      expect(w.document.body.textContent).not.toContain('Cliente de teste');
    } finally { dom.window.close(); }
  });
  it('shows all five statuses, including time-based grace and expiry, without calling validation or revoke', async () => {
    const now = Date.now();
    const { dom, w, fetch } = await setup([
      license,
      { ...license, id: 'grace', expiresAt: new Date(now - 60000).toISOString(), graceUntil: new Date(now + 60000).toISOString() },
      { ...license, id: 'expired', expiresAt: '2021-01-01T00:00:00Z', graceUntil: '2021-01-06T00:00:00Z' },
      { ...license, id: 'suspended', status: 'SUSPENDED' },
      { ...license, id: 'revoked', status: 'REVOKED' },
    ]);
    try {
      for (const status of ['ACTIVE', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED']) expect(w.document.querySelector(`[data-status="${status}"] strong`)?.textContent).toBe('1');
      expect(fetch.mock.calls.some(([url]) => url.includes('/validate') || url.includes('/revoke'))).toBe(false);
    } finally { dom.window.close(); }
  });
  it('creates a license using the installation UUID and API day limits', async () => {
    const { dom, w, fetch, submit, settle } = await setup([]);
    try {
      (w.document.querySelector('[data-view="licenses"]') as HTMLButtonElement).click();
      (w.document.querySelector('#create') as HTMLButtonElement).click();
      (w.document.querySelector('#installationId') as HTMLSelectElement).value = installation.id;
      submit(w.document.querySelector('#operation')!); await settle();
      const call = fetch.mock.calls.find(([url, init]) => url === '/api/v1/licenses' && init.method === 'POST');
      expect(JSON.parse(String(call![1].body))).toEqual({ installationId: installation.id, days: 30, graceDays: 5 });
    } finally { dom.window.close(); }
  });
  it('clears the session and any secret dialog when the API rejects an expired token', async () => {
    const { dom, w, fetch, settle } = await setup();
    try {
      fetch.mockImplementationOnce(async () => ({ ok: false, status: 401, json: async () => ({ success: false, error: 'UNAUTHORIZED' }) }));
      (w.document.querySelector('#refresh') as HTMLButtonElement).click(); await settle();
      expect(w.document.querySelector('#login')).not.toBeNull();
      expect(w.document.querySelector('#modal')?.innerHTML).toBe('');
      expect(w.document.body.textContent).not.toContain('Servidor teste');
    } finally { dom.window.close(); }
  });
  it('shows new installation secret once and removes it from DOM and storage after closing', async () => {
    const { dom, w, fetch, submit, settle } = await setup();
    try {
      (w.document.querySelector('[data-view="installations"]') as HTMLButtonElement).click();
      (w.document.querySelector('#create') as HTMLButtonElement).click();
      (w.document.querySelector('#name') as HTMLInputElement).value = 'Nova instalação';
      (w.document.querySelector('#clientId') as HTMLSelectElement).value = client.id;
      (w.document.querySelector('#productId') as HTMLSelectElement).value = product.id;
      submit(w.document.querySelector('#operation')!); await settle();
      expect(w.document.querySelector('#modal')?.textContent).toContain('ONE-TIME-SECRET');
      expect(w.localStorage.length).toBe(0); expect(w.sessionStorage.length).toBe(0);
      (w.document.querySelector('#modal [data-close]') as HTMLButtonElement).click();
      expect(w.document.body.innerHTML).not.toContain('ONE-TIME-SECRET');
      (w.document.querySelector('#refresh') as HTMLButtonElement).click(); await settle();
      expect(w.document.body.innerHTML).not.toContain('ONE-TIME-SECRET');
      const call = fetch.mock.calls.find(([url, init]) => url === '/api/v1/installations' && init.method === 'POST');
      expect(JSON.parse(String(call![1].body))).toEqual({ name: 'Nova instalação', clientId: client.id, productId: product.id });
    } finally { dom.window.close(); }
  });
});
