import type { UpdateRelease } from '@prisma/client';
import { ApiError } from '../utils/errors.js';

// Read-only proof of absence. A timeout, 401/403, redirect to an unknown origin,
// or unexpected response is never interpreted as a deleted release/file.
export async function assertUpdateReactivationSafe(
  release: UpdateRelease,
  config: { token: string; owner: string; repo: string },
  http: typeof fetch = fetch,
) {
  if (release.status !== 'DISABLED') throw new ApiError(409, 'INVALID_RELEASE_STATE');
  if (!config.token || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(config.owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(config.repo)) throw new ApiError(503, 'REACTIVATION_VERIFICATION_REQUIRED');
  const base = `https://api.github.com/repos/${config.owner}/${config.repo}`;
  const request = (url: string) => http(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${config.token}`, 'X-GitHub-Api-Version': '2026-03-10' } });
  try {
    const repo = await request(base);
    // Authenticate against the repository first: a masked 404 is not proof of absence.
    if (repo.status !== 200 || (await repo.json()).private !== false) throw Error();
    const paths = [`/releases/tags/${encodeURIComponent(release.githubTag)}`];
    const log = release.publicationLog as Record<string, unknown> | null;
    const ids = [release.githubReleaseId, typeof log?.releaseId === 'string' ? log.releaseId : null];
    for (const id of new Set(ids.filter((id): id is string => !!id))) {
      if (!/^[1-9][0-9]*$/.test(id)) throw Error();
      paths.push(`/releases/${id}`);
    }
    for (const path of paths) {
      const response = await request(base + path);
      if (response.status === 200) throw new ApiError(409, 'REACTIVATION_RELEASE_CONFLICT');
      if (response.status !== 404) throw Error();
    }
    const urls = [release.installerUrl, release.metadataUrl];
    if (Array.isArray(log?.assets)) for (const asset of log.assets) {
      if (asset && typeof asset === 'object' && typeof asset.downloadUrl === 'string') urls.push(asset.downloadUrl);
    }
    for (const stored of new Set(urls.filter((url): url is string => !!url))) {
      let url = stored, absent = false;
      for (let i = 0; i <= 5; i++) {
        const target = new URL(url);
        if (!['https://github.com', 'https://release-assets.githubusercontent.com'].includes(target.origin) || target.username || target.password || target.hash) throw Error();
        const response = await http(target, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000) });
        if ([404, 410].includes(response.status)) { absent = true; break; }
        if (response.status === 200) throw new ApiError(409, 'REACTIVATION_DISTRIBUTION_ACTIVE');
        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw Error();
        url = new URL(location, target).toString();
      }
      if (!absent) throw Error();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'REACTIVATION_VERIFICATION_REQUIRED');
  }
}
