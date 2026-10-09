import type { ReleaseInput } from '../utils/update-schemas.js';
import type { UpdateAsset } from './update-files.js';
import { createReadStream } from 'node:fs';

export interface PublicationResult {
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

// Future adapter contract. No real token/transport is connected to the routes.
// API: POST /repos/{owner}/{repo}/releases with draft:true;
// POST upload_url?name=... with raw binary; PATCH releases/{id} with draft:false.
export interface GitHubReleaseTransport {
  createDraft(input: { tag_name: string; name: string; body: string; prerelease: boolean }): Promise<{ id: string }>;
  upload(releaseId: string, asset: UpdateAsset): Promise<{ browserDownloadUrl: string }>;
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
      return await response.json() as Record<string, unknown>;
    } catch { throw new Error('GITHUB_REQUEST_FAILED'); }
  }
  private releaseId(id: string) { if (!/^[1-9][0-9]*$/.test(id)) throw new Error('INVALID_GITHUB_RELEASE_ID'); return id; }
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
      return { browserDownloadUrl: url.toString() };
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
    let id: string | undefined, stage = 'CREATE_DRAFT';
    try {
      id = (await this.transport.createDraft({ tag_name: `v${input.version}`, name: input.title, body: input.notes, prerelease: input.channel === 'beta' })).id;
      const urls: Partial<Record<UpdateAsset['kind'], string>> = {};
      for (const asset of assets) {
        stage = `UPLOAD_${asset.kind.toUpperCase()}`;
        urls[asset.kind] = (await this.transport.upload(id, asset)).browserDownloadUrl;
      }
      stage = 'PUBLISH'; await this.transport.publish(id);
      return { dryRun: false, githubReleaseId: id, installerUrl: urls.installer!, metadataUrl: urls.metadata!, steps: ['CREATE_DRAFT', 'UPLOAD_ALL', 'PUBLISH'] };
    } catch { throw new PartialPublicationError(id, stage); }
  }
}
