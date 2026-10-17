import type { ReleaseInput } from '../utils/update-schemas.js';
import type { UpdateAsset } from './update-files.js';
import { githubAssetName, prepareGitHubAssets, validateAssetName } from './update-files.js';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

// Exact HTTPS origins only. GitHub's browser download URL redirects to its release asset CDN.
const downloadOrigins = new Set(['https://github.com', 'https://release-assets.githubusercontent.com']);

export class GitHubRequestError extends Error {
  constructor(public readonly status: number | undefined, public readonly code?: string, public readonly stage?: string, message = 'GITHUB_REQUEST_FAILED') { super(message); }
}

export interface PublishedAsset { id: string; name: string; sourceName?: string; size: number; downloadUrl: string; kind: UpdateAsset['kind'] }
export interface PublicationResult {
  assets?: PublishedAsset[];
  dryRun: boolean; steps: string[]; githubReleaseId?: string; installerUrl?: string; metadataUrl?: string;
}
export interface ReleasePublisher {
  publish(input: ReleaseInput, assets: UpdateAsset[]): Promise<PublicationResult>;
}
export class DryRunPublisher implements ReleasePublisher {
  async publish(input: ReleaseInput, assets: UpdateAsset[]): Promise<PublicationResult> {
    return { dryRun: true, steps: [`SIMULATED_CREATE_DRAFT:v${input.version}`, ...assets.map(a => `SIMULATED_UPLOAD:${a.kind}`), 'SIMULATED_PUBLISH', 'NO_GITHUB_REQUESTS'] };
  }
}

// Backend-only adapter. Real routes require explicit server opt-in and admin action.
// API: POST /repos/{owner}/{repo}/releases with draft:true;
// POST upload_url?name=... with raw binary; PATCH releases/{id} with draft:false.
export interface GitHubReleaseTransport {
  assertPublic?(): Promise<void>;
  verify?(releaseId: string, assets: PublishedAsset[]): Promise<void>;
  verifyDownload?(url: string): Promise<void>;
  reconcilePublished?(id: string, input: ReleaseInput, assets: UpdateAsset[]): Promise<PublishedAsset[]>;
  remove?(releaseId: string): Promise<void>;
  createDraft(input: { tag_name: string; name: string; body: string; prerelease: boolean }): Promise<{ id: string }>;
  upload(releaseId: string, asset: UpdateAsset): Promise<{ browserDownloadUrl: string; id?: string; name?: string; size?: number }>;
  publish(releaseId: string): Promise<void>;
}
export class GitHubHttpTransport implements GitHubReleaseTransport {
  private readonly repository: string;
  constructor(private readonly config: { token: string; owner: string; repo: string }, private readonly http: typeof fetch = fetch) {
    if (!config.token || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(config.owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(config.repo)) throw new Error('INVALID_GITHUB_CONFIGURATION');
    this.repository = `/repos/${config.owner}/${config.repo}/releases`;
  }
  private async request(url: string, options: RequestInit, stage?: string) {
    try {
      const response = await this.http(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(300_000), headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.config.token}`, 'X-GitHub-Api-Version': '2026-03-10', ...options.headers,
      } });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { errors?: { code?: string }[] };
        throw new GitHubRequestError(response.status, Array.isArray(data?.errors) && data.errors.some(e => e?.code === 'already_exists') ? 'already_exists' : undefined, stage);
      }
      if (response.status === 204) return {};
      try { return await response.json() as Record<string, unknown>; }
      catch { throw new GitHubRequestError(response.status, 'invalid_response', stage); }
    } catch (error) {
      if (error instanceof GitHubRequestError) throw error;
      throw new GitHubRequestError(undefined, error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network_error', stage);
    }
  }
  private releaseId(id: string) { if (!/^[1-9][0-9]*$/.test(id)) throw new Error('INVALID_GITHUB_RELEASE_ID'); return id; }
  private remoteAsset(value: any, kind: UpdateAsset['kind'], tag?: string): PublishedAsset {
    try {
      if (!Number.isSafeInteger(value.id) || value.id <= 0 || value.state !== 'uploaded' || !Number.isSafeInteger(value.size) || value.size <= 0 || typeof value.name !== 'string' || typeof value.browser_download_url !== 'string') throw Error();
      validateAssetName(value.name, kind, kind === 'metadata' ? 'text/yaml' : 'application/octet-stream');
      const url = new URL(value.browser_download_url);
      const parts = url.pathname.split('/');
      if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || parts.length !== 7 || parts[1] !== this.config.owner || parts[2] !== this.config.repo || parts[3] !== 'releases' || parts[4] !== 'download' || !parts[5] || (tag !== undefined && decodeURIComponent(parts[5]!) !== tag) || decodeURIComponent(parts[6]!) !== value.name) throw Error();
      // Validate the API URL; never synthesize a replacement URL from a local name.
      return { id: String(value.id), name: value.name, size: value.size, kind, downloadUrl: value.browser_download_url };
    } catch { throw new Error('INVALID_GITHUB_ASSET'); }
  }
  async verifyDownload(url: string) {
    // No GitHub credentials are sent to browser/CDN URLs, including redirects.
    let status: number | undefined, redirects = 0, initialOrigin: string | null = null, finalOrigin: string | null = null;
    let reason = 'GITHUB_DOWNLOAD_INVALID_REDIRECT', awaitingHttp = false;
    try {
      initialOrigin = new URL(url).origin;
      console.info('[UPDATES] download verification start', { initialOrigin });
      for (;;) {
        const u = new URL(url);
        finalOrigin = u.origin;
        if (!downloadOrigins.has(u.origin) || u.username || u.password || u.hash) { reason = 'GITHUB_DOWNLOAD_ORIGIN_UNVERIFIED'; status = undefined; throw new Error(); }
        status = undefined; awaitingHttp = true;
        let response = await this.http(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(30000) });
        awaitingHttp = false;
        // Some download frontends reject HEAD. Confirm with a bounded GET, using
        // identical origin/redirect checks and cancelling the body immediately.
        if ([404, 405].includes(response.status)) {
          console.info('[UPDATES] download verification probe', { origin: u.origin, status: response.status, redirects });
          awaitingHttp = true;
          response = await this.http(u, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
          awaitingHttp = false;
          await response.body?.cancel();
        }
        status = response.status;
        if ([200, 206].includes(status)) {
          console.info('[UPDATES] download verification complete', { initialOrigin, finalOrigin, status, redirects }); return;
        }
        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(status)) { reason = 'GITHUB_DOWNLOAD_HTTP_ERROR'; throw new Error(); }
        if (!location) { reason = 'GITHUB_DOWNLOAD_INVALID_REDIRECT'; throw new Error(); }
        const next = new URL(location, u);
        redirects++;
        console.info('[UPDATES] download verification redirect', { fromOrigin: u.origin, toOrigin: next.origin, status, redirects });
        if (!downloadOrigins.has(next.origin) || next.username || next.password || next.hash) {
          finalOrigin = next.origin; reason = 'GITHUB_DOWNLOAD_ORIGIN_UNVERIFIED'; status = undefined; throw new Error();
        }
        if (redirects > 5) { reason = 'GITHUB_DOWNLOAD_REDIRECT_LIMIT'; throw new Error(); }
        url = next.toString();
      }
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) reason = 'GITHUB_DOWNLOAD_TIMEOUT';
      else if (awaitingHttp) { reason = 'GITHUB_DOWNLOAD_NETWORK_ERROR'; status = undefined; }
      // Never log URL paths, query strings, Location headers or exception messages.
      console.info('[UPDATES] download verification failed', { initialOrigin, finalOrigin, status: status ?? null, redirects, reason });
    }
    throw new GitHubRequestError(status, 'download_unverified', 'DOWNLOAD_VERIFY', reason);
  }
  async reconcilePublished(id: string, input: ReleaseInput, assets: UpdateAsset[]): Promise<PublishedAsset[]> {
    const value = await this.request(`https://api.github.com${this.repository}/${this.releaseId(id)}`, { method: 'GET' }, 'VERIFY_PUBLISHED_RELEASE');
    const key = createHash('sha256').update(JSON.stringify([input.productId, input.version, input.channel])).digest('hex');
    if (String(value.id) !== id || value.draft !== false || value.tag_name !== `v${input.version}` || value.prerelease !== (input.channel === 'beta') || value.body !== `${input.notes}\n\n<!-- central-licencas:${key} -->` || !Array.isArray(value.assets) || value.assets.length !== 3 || assets.length !== 3 || new Set(assets.map(a => a.kind)).size !== 3) throw new GitHubRequestError(undefined, undefined, 'VERIFY_PUBLISHED_RELEASE', 'GITHUB_RELEASE_CONFLICT');
    const published: PublishedAsset[] = [];
    for (const asset of assets) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(asset.path)) hash.update(chunk);
      const digest = `sha256:${hash.digest('hex')}`;
      const candidates = value.assets.filter((a: any) => a.size === asset.size && a.digest === digest && a.state === 'uploaded' && a.name === githubAssetName(asset.name));
      if (candidates.length !== 1) throw new GitHubRequestError(undefined, undefined, 'VERIFY_PUBLISHED_RELEASE', asset.kind === 'metadata' ? 'GITHUB_METADATA_RECONCILIATION_REQUIRED' : 'GITHUB_ASSETS_INCOMPLETE');
      const remote = this.remoteAsset(candidates[0], asset.kind, `v${input.version}`);
      published.push({ ...remote, sourceName: asset.sourceName ?? asset.name });
    }
    if (new Set(published.map(a => a.id)).size !== 3) throw new GitHubRequestError(undefined, undefined, 'VERIFY_PUBLISHED_RELEASE', 'GITHUB_ASSETS_INCOMPLETE');
    return published;
  }
  async assertPublic() {
    const repo = await this.request(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}`, { method: 'GET' });
    if (repo.private !== false || repo.visibility !== 'public') throw new Error('PUBLIC_UPDATES_REPOSITORY_REQUIRED');
  }
  async remove(id: string) {
    try { await this.request(`https://api.github.com${this.repository}/${this.releaseId(id)}`, { method: 'DELETE' }); }
    catch (error) { if (!(error instanceof GitHubRequestError) || error.status !== 404) throw error; }
  }
  async verify(id: string, assets: PublishedAsset[]) {
    const release = await this.request(`https://api.github.com${this.repository}/${this.releaseId(id)}`, { method: 'GET' });
    if (!Array.isArray(release.assets) || release.assets.length !== 3) throw new Error('GITHUB_ASSETS_INCOMPLETE');
    for (const asset of assets) {
      if (!release.assets.some((a: any) => String(a.id) === asset.id && a.name === asset.name && a.size === asset.size && a.state === 'uploaded' && a.browser_download_url === asset.downloadUrl)) throw new Error('GITHUB_ASSETS_INCOMPLETE');
    }
  }
  async createDraft(input: { tag_name: string; name: string; body: string; prerelease: boolean }, recoveryOnly = false): Promise<{ id: string }> {
    // List releases: the by-tag endpoint only returns published releases, not drafts.
    const matches: Record<string, unknown>[] = [];
    for (let page = 1; ; page++) {
      const releases = await this.request(`https://api.github.com${this.repository}?per_page=100&page=${page}`, { method: 'GET' }, 'CHECK_EXISTING_RELEASE');
      if (!Array.isArray(releases)) throw new GitHubRequestError(undefined, 'invalid_response', 'CHECK_EXISTING_RELEASE', 'INVALID_GITHUB_RESPONSE');
      matches.push(...releases.filter(r => r.tag_name === input.tag_name));
      if (releases.length < 100) break;
    }
    if (matches.length) {
      const existing = matches[0]!;
      const marker = input.body.match(/<!-- central-licencas:[a-f0-9]{64} -->$/)?.[0];
      if (matches.length !== 1 || existing.draft !== true || !marker || existing.body !== input.body || existing.name !== input.name || existing.prerelease !== input.prerelease) throw new GitHubRequestError(undefined, undefined, 'CHECK_EXISTING_RELEASE', 'GITHUB_RELEASE_CONFLICT');
      if (!Number.isSafeInteger(existing.id) || Number(existing.id) <= 0) throw new GitHubRequestError(undefined, 'invalid_response', 'CHECK_EXISTING_RELEASE', 'INVALID_GITHUB_RESPONSE');
      const id = String(existing.id);
      // Restart owned drafts with a clean asset set, including ambiguous/failed uploads.
      const staleAssets: Record<string, unknown>[] = [];
      for (let page = 1; ; page++) {
        const assets = await this.request(`https://api.github.com${this.repository}/${id}/assets?per_page=100&page=${page}`, { method: 'GET' }, 'CLEAN_DRAFT_ASSETS');
        if (!Array.isArray(assets)) throw new GitHubRequestError(undefined, 'invalid_response', 'CLEAN_DRAFT_ASSETS', 'INVALID_GITHUB_RESPONSE');
        // Collect before deleting so pagination cannot skip entries.
        for (const asset of assets) if (!/^[1-9][0-9]*$/.test(String(asset.id))) throw new GitHubRequestError(undefined, 'invalid_response', 'CLEAN_DRAFT_ASSETS', 'INVALID_GITHUB_RESPONSE');
        staleAssets.push(...assets);
        if (assets.length < 100) break;
      }
      for (const asset of staleAssets) await this.request(`https://api.github.com${this.repository}/assets/${this.releaseId(String(asset.id))}`, { method: 'DELETE' }, 'CLEAN_DRAFT_ASSETS');
      return { id };
    }
    // GitHub accepts an existing tag; never create, move or delete a Git ref here.
    if (recoveryOnly) throw new Error('GITHUB_DRAFT_NOT_RECOVERED');
    let value: Record<string, unknown>;
    try {
      value = await this.request(`https://api.github.com${this.repository}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, draft: true }) }, 'CREATE_RELEASE');
    } catch (error) {
      // A lost response can leave an owned draft. Reconcile once; never blindly POST again.
      try { return await this.createDraft(input, true); } catch { throw error; }
    }
    if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) throw new Error('INVALID_GITHUB_RESPONSE');
    return { id: String(value.id) };
  }
  async upload(releaseId: string, asset: UpdateAsset) {
    const stream = createReadStream(asset.path);
    try {
      const options = { method: 'POST', duplex: 'half', headers: { 'Content-Type': asset.mime, 'Content-Length': String(asset.size) }, body: stream as unknown as BodyInit };
      const value = await this.request(`https://uploads.github.com${this.repository}/${this.releaseId(releaseId)}/assets?name=${encodeURIComponent(asset.name)}`, options);
      const remote = this.remoteAsset(value, asset.kind);
      if (remote.name !== githubAssetName(asset.name) || remote.size !== asset.size) throw new Error('INVALID_GITHUB_ASSET');
      return { browserDownloadUrl: remote.downloadUrl, id: remote.id, name: remote.name, size: remote.size };
    } finally { stream.destroy(); }
  }
  async publish(releaseId: string) {
    const url = `https://api.github.com${this.repository}/${this.releaseId(releaseId)}`;
    let value: Record<string, unknown>;
    try { value = await this.request(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'false' }) }); }
    catch (error) {
      // Only reconcile the exact release just published by this operation.
      // An unrelated published release still conflicts in createDraft().
      try { value = await this.request(url, { method: 'GET' }); } catch { throw error; }
      if (String(value.id) !== releaseId || value.draft !== false) throw error;
    }
    if (value.draft !== false) throw new Error('GITHUB_RELEASE_NOT_PUBLISHED');
  }
}
export class PartialPublicationError extends Error {
  constructor(public readonly releaseId: string | undefined, public readonly stage: string, public readonly reason?: string, public readonly githubStatus?: number, public readonly githubCode?: string) { super('GITHUB_PUBLICATION_FAILED'); }
}
export class GitHubReleasePublisher implements ReleasePublisher {
  constructor(private readonly transport: GitHubReleaseTransport) {}
  async publish(input: ReleaseInput, assets: UpdateAsset[], recoveryId?: string): Promise<PublicationResult> {
    let id: string | undefined = recoveryId, stage = 'CHECK_PUBLIC_REPOSITORY';
    try {
      await this.transport.assertPublic?.();
      assets = await prepareGitHubAssets(assets);
      if (recoveryId) {
        id = recoveryId; stage = 'VERIFY_PUBLISHED_RELEASE';
        if (!this.transport.reconcilePublished) throw new Error('GITHUB_RELEASE_CONFLICT');
        const recovered = await this.transport.reconcilePublished(id, input, assets);
        stage = 'DOWNLOAD_VERIFY';
        for (const asset of recovered) await this.transport.verifyDownload?.(asset.downloadUrl);
        return { dryRun: false, assets: recovered, githubReleaseId: id, installerUrl: recovered.find(a => a.kind === 'installer')!.downloadUrl, metadataUrl: recovered.find(a => a.kind === 'metadata')!.downloadUrl, steps: ['RECONCILE_EXISTING_RELEASE', 'VERIFY_ASSETS', 'DOWNLOAD_VERIFY'] };
      }
      stage = 'CREATE_RELEASE';
      const key = createHash('sha256').update(JSON.stringify([input.productId, input.version, input.channel])).digest('hex');
      id = (await this.transport.createDraft({ tag_name: `v${input.version}`, name: `Sistema de Atendimento ${input.version}`, body: `${input.notes}\n\n<!-- central-licencas:${key} -->`, prerelease: input.channel === 'beta' })).id;
      const urls: Partial<Record<UpdateAsset['kind'], string>> = {};
      const published: PublishedAsset[] = [];
      for (const asset of [...assets].sort((a, b) => ['installer', 'metadata', 'blockmap'].indexOf(a.kind) - ['installer', 'metadata', 'blockmap'].indexOf(b.kind))) {
        stage = asset.kind === 'metadata' ? 'UPLOAD_LATEST_YML' : `UPLOAD_${asset.kind.toUpperCase()}`;
        const uploaded = await this.transport.upload(id, asset);
        urls[asset.kind] = uploaded.browserDownloadUrl;
        published.push({ id: uploaded.id ?? '', name: uploaded.name ?? asset.name, sourceName: asset.sourceName ?? asset.name, kind: asset.kind, size: uploaded.size ?? asset.size, downloadUrl: uploaded.browserDownloadUrl });
      }
      stage = 'VERIFY_ASSETS'; await this.transport.verify?.(id, published);
      stage = 'PUBLISH_RELEASE'; await this.transport.publish(id);
      stage = 'DOWNLOAD_VERIFY';
      for (const asset of published) await this.transport.verifyDownload?.(asset.downloadUrl);
      return { assets: published, dryRun: false, githubReleaseId: id, installerUrl: urls.installer!, metadataUrl: urls.metadata!, steps: ['CREATE_DRAFT', 'UPLOAD_ALL', 'PUBLISH'] };
    } catch (error) {
      if (id && !recoveryId && stage !== 'DOWNLOAD_VERIFY') { try { await this.transport.remove?.(id); } catch { /* Safe release id retained for recovery. */ } }
      const safeReasons = ['GITHUB_RELEASE_CONFLICT', 'GITHUB_METADATA_RECONCILIATION_REQUIRED', 'GITHUB_ASSETS_INCOMPLETE', 'INVALID_GITHUB_RESPONSE', 'INVALID_GITHUB_ASSET', 'INVALID_GITHUB_DOWNLOAD_URL', 'GITHUB_RELEASE_NOT_PUBLISHED', 'GITHUB_DOWNLOAD_ORIGIN_UNVERIFIED', 'GITHUB_DOWNLOAD_HTTP_ERROR', 'GITHUB_DOWNLOAD_NETWORK_ERROR', 'GITHUB_DOWNLOAD_TIMEOUT', 'GITHUB_DOWNLOAD_INVALID_REDIRECT', 'GITHUB_DOWNLOAD_REDIRECT_LIMIT', 'PUBLIC_UPDATES_REPOSITORY_REQUIRED'];
      throw new PartialPublicationError(id, error instanceof GitHubRequestError ? error.stage ?? stage : stage, error instanceof Error && safeReasons.includes(error.message) ? error.message : undefined, error instanceof GitHubRequestError ? error.status : undefined, error instanceof GitHubRequestError ? error.code : undefined);
    }
  }
}
