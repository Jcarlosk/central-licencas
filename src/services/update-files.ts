import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { ApiError } from '../utils/errors.js';

export const MAX_FILE_BYTES = 250 * 1024 * 1024;
export const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_BLOCKMAP_BYTES = 10 * 1024 * 1024;
export interface UpdateAsset { name: string; path: string; size: number; mime: string; kind: 'installer' | 'metadata' | 'blockmap'; }
export function validateAssetName(name: string, kind: UpdateAsset['kind'], mime: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,159}$/.test(name) || name.includes('..')) throw new ApiError(400, 'INVALID_FILE_NAME');
  const extensions = { installer: /\.exe$/i, metadata: /^latest\.yml$/, blockmap: /\.exe\.blockmap$/i };
  if (!extensions[kind].test(name)) throw new ApiError(400, 'INVALID_FILE_EXTENSION');
  const allowed = kind === 'installer' ? ['application/octet-stream', 'application/x-msdownload', 'application/x-msdos-program', 'application/vnd.microsoft.portable-executable'] : kind === 'metadata' ? ['application/octet-stream', 'text/yaml', 'application/yaml', 'text/plain', 'application/x-yaml', 'text/x-yaml'] : ['application/octet-stream'];
  if (!allowed.includes(mime)) throw new ApiError(400, 'INVALID_FILE_MIME');
}
export async function validateUpdateAssets(assets: UpdateAsset[], version: string) {
  if (assets.length !== 3 || new Set(assets.map(a => a.kind)).size !== 3) throw new ApiError(400, 'INVALID_FILE_COUNT');
  for (const asset of assets) {
    validateAssetName(asset.name, asset.kind, asset.mime);
    const max = asset.kind === 'metadata' ? MAX_METADATA_BYTES : asset.kind === 'blockmap' ? MAX_BLOCKMAP_BYTES : MAX_FILE_BYTES;
    if (!asset.size || asset.size > max) throw new ApiError(413, 'FILE_TOO_LARGE');
  }
  const installer = assets.find(a => a.kind === 'installer')!;
  const metadata = assets.find(a => a.kind === 'metadata')!;
  if (assets.find(a => a.kind === 'blockmap')!.name !== `${installer.name}.blockmap`) throw new ApiError(400, 'BLOCKMAP_MISMATCH');
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  let signature = Buffer.alloc(0);
  for await (const chunk of createReadStream(installer.path)) {
    const bytes = chunk as Buffer;
    if (signature.length < 2) signature = Buffer.concat([signature, bytes]).subarray(0, 2);
    sha256.update(bytes); sha512.update(bytes);
  }
  if (signature.toString('ascii') !== 'MZ') throw new ApiError(400, 'INVALID_INSTALLER');
  const digest512 = sha512.digest('base64');
  try {
    const doc = parseDocument(await readFile(metadata.path, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length) throw new Error();
    const value = doc.toJS({ maxAliasCount: 0 });
    if (!value || value.version !== version || !Array.isArray(value.files) || value.files.length !== 1) throw new Error();
    const file = value.files[0];
    if (file.url !== installer.name || file.sha512 !== digest512 || file.size !== installer.size) throw new Error();
    if (value.path !== undefined && value.path !== installer.name) throw new Error();
    if (value.sha512 !== undefined && value.sha512 !== digest512) throw new Error();
  } catch { throw new ApiError(400, 'INVALID_UPDATE_METADATA'); }
  return { sha256: sha256.digest('hex'), assets: assets.map(a => ({ name: a.name, kind: a.kind, size: a.size })) };
}
