import type { ReleaseInput } from '../utils/update-schemas.js';
import type { UpdateAsset } from './update-files.js';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export class GitHubRequestError extends Error {
  constructor(public readonly status: number | undefined, public readonly code?: string, public readonly stage?: string, message = 'GITHUB_REQUEST_FAILED') { super(message); }
}

export interface PublishedAsset { id: string; name: string; size: number; downloadUrl: string; kind: UpdateAsset['kind'] }
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
  remove?(releaseId: string): Promise<void>;
  createDraft(input: { tag_name: string; name: string; body: string; prerelease: boolean }): Promise<{ id: string }>;
  upload(releaseId: string, asset: UpdateAsset): Promise<{ browserDownloadUrl: string; id?: string }>;
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
  async verifyDownload(url: string) {
    // No GitHub credentials are sent to browser/CDN URLs, including redirects.
    let status: number | undefined;
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const u = new URL(url);
        if (!['https://github.com', 'https://release-assets.githubusercontent.com'].includes(u.origin) || u.username || u.password || u.hash) throw new Error();
        const response = await this.http(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(30000) });
        status = response.status;
        if (response.status === 200) return;
        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error();
        url = new URL(location, u).toString();
      }
    } catch { /* Never expose CDN signed URLs or transport errors. */ }
    throw new GitHubRequestError(status, 'download_unverified', 'DOWNLOAD_VERIFY', 'GITHUB_DOWNLOAD_ORIGIN_UNVERIFIED');
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
      if (typeof value.browser_download_url !== 'string' || value.state !== 'uploaded' || value.name !== asset.name || value.size !== asset.size) throw new Error('INVALID_GITHUB_ASSET');
      const url = new URL(value.browser_download_url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${this.config.owner}/${this.config.repo}/releases/download/`) || url.username || url.password) throw new Error('INVALID_GITHUB_DOWNLOAD_URL');
      if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0 || url.search || url.hash || decodeURIComponent(url.pathname.split('/').pop()!) !== asset.name) throw new Error('INVALID_GITHUB_ASSET');
      return { browserDownloadUrl: url.toString(), id: String(value.id) };
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
  async publish(input: ReleaseInput, assets: UpdateAsset[]): Promise<PublicationResult> {
    let id: string | undefined, stage = 'CHECK_PUBLIC_REPOSITORY';
    try {
      await this.transport.assertPublic?.();
      stage = 'CREATE_RELEASE';
      const key = createHash('sha256').update(JSON.stringify([input.productId, input.version, input.channel])).digest('hex');
      id = (await this.transport.createDraft({ tag_name: `v${input.version}`, name: `Sistema de Atendimento ${input.version}`, body: `${input.notes}\n\n<!-- central-licencas:${key} -->`, prerelease: input.channel === 'beta' })).id;
      const urls: Partial<Record<UpdateAsset['kind'], string>> = {};
      const published: PublishedAsset[] = [];
      for (const asset of [...assets].sort((a, b) => ['installer', 'metadata', 'blockmap'].indexOf(a.kind) - ['installer', 'metadata', 'blockmap'].indexOf(b.kind))) {
        stage = asset.kind === 'metadata' ? 'UPLOAD_LATEST_YML' : `UPLOAD_${asset.kind.toUpperCase()}`;
        const uploaded = await this.transport.upload(id, asset);
        urls[asset.kind] = uploaded.browserDownloadUrl;
        published.push({ id: uploaded.id ?? '', name: asset.name, kind: asset.kind, size: asset.size, downloadUrl: uploaded.browserDownloadUrl });
      }
      stage = 'VERIFY_ASSETS'; await this.transport.verify?.(id, published);
      stage = 'PUBLISH_RELEASE'; await this.transport.publish(id);
      stage = 'DOWNLOAD_VERIFY'; await this.transport.verifyDownload?.(urls.installer!);
      return { assets: published, dryRun: false, githubReleaseId: id, installerUrl: urls.installer!, metadataUrl: urls.metadata!, steps: ['CREATE_DRAFT', 'UPLOAD_ALL', 'PUBLISH'] };
    } catch (error) {
      if (id) { try { await this.transport.remove?.(id); } catch { /* Safe release id retained for manual recovery. */ } }
      const safeReasons = ['GITHUB_RELEASE_CONFLICT', 'GITHUB_ASSETS_INCOMPLETE', 'INVALID_GITHUB_RESPONSE', 'INVALID_GITHUB_ASSET', 'INVALID_GITHUB_DOWNLOAD_URL', 'GITHUB_RELEASE_NOT_PUBLISHED', 'GITHUB_DOWNLOAD_ORIGIN_UNVERIFIED', 'PUBLIC_UPDATES_REPOSITORY_REQUIRED'];
      throw new PartialPublicationError(id, error instanceof GitHubRequestError ? error.stage ?? stage : stage, error instanceof Error && safeReasons.includes(error.message) ? error.message : undefined, error instanceof GitHubRequestError ? error.status : undefined, error instanceof GitHubRequestError ? error.code : undefined);
    }
  }
}
