import { ApiError } from '../utils/errors.js';
import { PartialPublicationError } from './github-releases.js';

const stageCodes = {
  CHECK_PUBLIC_REPOSITORY: 'GITHUB_REPOSITORY_CHECK_FAILED',
  CHECK_EXISTING_RELEASE: 'GITHUB_RELEASE_CHECK_FAILED',
  CREATE_RELEASE: 'GITHUB_RELEASE_CREATE_FAILED',
  CLEAN_DRAFT_ASSETS: 'GITHUB_DRAFT_CLEANUP_FAILED',
  UPLOAD_INSTALLER: 'GITHUB_INSTALLER_UPLOAD_FAILED',
  UPLOAD_LATEST_YML: 'GITHUB_METADATA_UPLOAD_FAILED',
  UPLOAD_BLOCKMAP: 'GITHUB_BLOCKMAP_UPLOAD_FAILED',
  VERIFY_ASSETS: 'GITHUB_ASSETS_VERIFY_FAILED',
  VERIFY_PUBLISHED_RELEASE: 'GITHUB_PUBLISHED_RELEASE_VERIFY_FAILED',
  PUBLISH_RELEASE: 'GITHUB_RELEASE_PUBLISH_FAILED',
  DOWNLOAD_VERIFY: 'GITHUB_DOWNLOAD_VERIFY_FAILED',
  PERSIST_PUBLICATION: 'PUBLICATION_PERSIST_FAILED',
} as const;

export function publicationDiagnostic(error: unknown) {
  const partial = error instanceof PartialPublicationError ? error : undefined;
  const stage = partial && Object.hasOwn(stageCodes, partial.stage) ? partial.stage as keyof typeof stageCodes : 'PERSIST_PUBLICATION';
  const reasons = ['GITHUB_RELEASE_CONFLICT', 'GITHUB_METADATA_RECONCILIATION_REQUIRED', 'GITHUB_ASSETS_INCOMPLETE', 'INVALID_GITHUB_RESPONSE', 'INVALID_GITHUB_ASSET', 'INVALID_GITHUB_DOWNLOAD_URL', 'GITHUB_RELEASE_NOT_PUBLISHED', 'GITHUB_DOWNLOAD_ORIGIN_UNVERIFIED', 'GITHUB_DOWNLOAD_HTTP_ERROR', 'GITHUB_DOWNLOAD_NETWORK_ERROR', 'GITHUB_DOWNLOAD_TIMEOUT', 'GITHUB_DOWNLOAD_INVALID_REDIRECT', 'GITHUB_DOWNLOAD_REDIRECT_LIMIT', 'PUBLIC_UPDATES_REPOSITORY_REQUIRED'];
  return {
    stage, code: stageCodes[stage],
    githubStatus: partial?.githubStatus && Number.isInteger(partial.githubStatus) && partial.githubStatus >= 100 && partial.githubStatus <= 599 ? partial.githubStatus : null,
    alreadyExists: partial?.githubCode === 'already_exists',
    reason: partial?.reason && reasons.includes(partial.reason) ? partial.reason : partial?.githubCode === 'timeout' ? 'GITHUB_TIMEOUT' : partial?.githubCode === 'network_error' ? 'GITHUB_NETWORK_ERROR' : partial?.githubCode === 'invalid_response' ? 'INVALID_GITHUB_RESPONSE' : null,
  };
}

export class RealPublicationApiError extends ApiError {
  constructor(public readonly diagnostic: ReturnType<typeof publicationDiagnostic>) { super(502, 'REAL_PUBLICATION_FAILED'); }
}
