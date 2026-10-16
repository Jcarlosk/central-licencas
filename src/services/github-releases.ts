import type { ReleaseInput } from '../utils/update-schemas.js';
import type { UpdateAsset } from './update-files.js';
import { createReadStream } from 'node:fs';

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
  private async request(url: string, options: RequestInit) {
    try {
      const response = await this.http(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(300_000), headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.config.token}`, 'X-GitHub-Api-Version': '2026-03-10', ...options.headers,
      } });
      if (!response.ok) throw new Error();
      if (response.status === 204) return {};
      return await response.json() as Record<string, unknown>;
    } catch { throw new Error('GITHUB_REQUEST_FAILED'); }
  }
  private releaseId(id: string) { if (!/^[1-9][0-9]*$/.test(id)) throw new Error('INVALID_GITHUB_RELEASE_ID'); return id; }
  async verifyDownload(url: string) {
    // No GitHub credentials are sent to browser/CDN URLs, including redirects.
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const u = new URL(url);
        if (!['https://github.com', 'https://release-assets.githubusercontent.com'].includes(u.origin) || u.username || u.password || u.hash) throw new Error();
        const response = await this.http(u, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(30000) });
        if (response.status === 200) return;
        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error();
        url = new URL(location, u).toString();
      }
    } catch { /* Never expose CDN signed URLs or transport errors. */ }
    throw new Error('GITHUB_DOWNLOAD_ORIGIN_UNVERIFIED');
  }
  async assertPublic() {
    const repo = await this.request(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}`, { method: 'GET' });
    if (repo.private !== false || repo.visibility !== 'public') throw new Error('PUBLIC_UPDATES_REPOSITORY_REQUIRED');
  }
  async remove(id: string) {
    await this.request(`https://api.github.com${this.repository}/${this.releaseId(id)}`, { method: 'DELETE' });
  }
  async verify(id: string, assets: PublishedAsset[]) {
    const release = await this.request(`https://api.github.com${this.repository}/${this.releaseId(id)}`, { method: 'GET' });
    if (!Array.isArray(release.assets) || release.assets.length !== 3) throw new Error('GITHUB_ASSETS_INCOMPLETE');
    for (const asset of assets) {
      if (!release.assets.some((a: any) => String(a.id) === asset.id && a.name === asset.name && a.size === asset.size && a.state === 'uploaded' && a.browser_download_url === asset.downloadUrl)) throw new Error('GITHUB_ASSETS_INCOMPLETE');
    }
  }
  async createDraft(input: { tag_name: string; name: string; body: string; prerelease: boolean }) {
    const value = await this.request(`https://api.github.com${this.repository}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, draft: true }) });
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
    const value = await this.request(`https://api.github.com${this.repository}/${this.releaseId(releaseId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'false' }) });
    if (value.draft !== false) throw new Error('GITHUB_RELEASE_NOT_PUBLISHED');
  }
}
export class PartialPublicationError extends Error {
  constructor(public readonly releaseId: string | undefined, public readonly stage: string) { super('GITHUB_PUBLICATION_FAILED'); }
}
export class GitHubReleasePublisher implements ReleasePublisher {
  constructor(private readonly transport: GitHubReleaseTransport) {}
  async publish(input: ReleaseInput, assets: UpdateAsset[]): Promise<PublicationResult> {
    let id: string | undefined, stage = 'CHECK_PUBLIC_REPOSITORY';
    try {
      await this.transport.assertPublic?.();
      stage = 'CREATE_DRAFT';
      id = (await this.transport.createDraft({ tag_name: `v${input.version}`, name: `Sistema de Atendimento ${input.version}`, body: input.notes, prerelease: input.channel === 'beta' })).id;
      const urls: Partial<Record<UpdateAsset['kind'], string>> = {};
      const published: PublishedAsset[] = [];
      for (const asset of [...assets].sort((a, b) => ['installer', 'metadata', 'blockmap'].indexOf(a.kind) - ['installer', 'metadata', 'blockmap'].indexOf(b.kind))) {
        stage = `UPLOAD_${asset.kind.toUpperCase()}`;
        const uploaded = await this.transport.upload(id, asset);
        urls[asset.kind] = uploaded.browserDownloadUrl;
        published.push({ id: uploaded.id ?? '', name: asset.name, kind: asset.kind, size: asset.size, downloadUrl: uploaded.browserDownloadUrl });
      }
      stage = 'VERIFY_ASSETS'; await this.transport.verify?.(id, published);
      stage = 'PUBLISH'; await this.transport.publish(id);
      stage = 'VERIFY_DOWNLOAD'; await this.transport.verifyDownload?.(urls.installer!);
      return { assets: published, dryRun: false, githubReleaseId: id, installerUrl: urls.installer!, metadataUrl: urls.metadata!, steps: ['CREATE_DRAFT', 'UPLOAD_ALL', 'PUBLISH'] };
    } catch {
      if (id) { try { await this.transport.remove?.(id); } catch { /* Safe release id retained for manual recovery. */ } }
      throw new PartialPublicationError(id, stage);
    }
  }
}
