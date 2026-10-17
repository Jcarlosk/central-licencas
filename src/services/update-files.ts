import { gunzipSync } from 'node:zlib';
import { blake2b } from 'blakejs';
import { createReadStream } from 'node:fs';
import { readFile, stat, open, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { ApiError } from '../utils/errors.js';

export const MAX_FILE_BYTES = 250 * 1024 * 1024;
export const MAX_METADATA_BYTES = 64 * 1024;
export const MAX_BLOCKMAP_BYTES = 10 * 1024 * 1024;
export interface UpdateAsset { name: string; sourceName?: string; path: string; size: number; mime: string; kind: 'installer' | 'metadata' | 'blockmap'; }
export function githubAssetName(name: string) { return name.replace(/ /g, '.'); }
// Only operates on the upload's temporary metadata copy, after original validation.
export async function prepareGitHubAssets(assets: UpdateAsset[]): Promise<UpdateAsset[]> {
  const installer = assets.find(a => a.kind === 'installer')!;
  const name = githubAssetName(installer.name);
  if (name === installer.name) return assets;
  const metadata = assets.find(a => a.kind === 'metadata')!;
  const document = parseDocument(await readFile(metadata.path, 'utf8'));
  document.set('path', name);
  document.setIn(['files', 0, 'url'], name);
  await writeFile(metadata.path, document.toString(), 'utf8');
  return assets.map(asset => ({ ...asset,
    sourceName: asset.sourceName ?? asset.name,
    name: asset.kind === 'installer' ? name : asset.kind === 'blockmap' ? `${name}.blockmap` : asset.name,
    size: asset.kind === 'metadata' ? Buffer.byteLength(document.toString()) : asset.size,
  }));
}
export function validateAssetName(name: string, kind: UpdateAsset['kind'], mime: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,159}$/.test(name) || name.includes('..')) throw new ApiError(400, 'INVALID_FILE_NAME');
  const extensions = { installer: /\.exe$/i, metadata: /^latest\.yml$/, blockmap: /\.exe\.blockmap$/i };
  if (!extensions[kind].test(name)) throw new ApiError(400, 'INVALID_FILE_EXTENSION');
  const allowed = kind === 'installer' ? ['application/octet-stream', 'application/x-msdownload', 'application/x-msdos-program', 'application/vnd.microsoft.portable-executable'] : kind === 'metadata' ? ['application/octet-stream', 'text/yaml', 'application/yaml', 'text/plain', 'application/x-yaml', 'text/x-yaml'] : ['application/octet-stream'];
  if (!allowed.includes(mime)) throw new ApiError(400, 'INVALID_FILE_MIME');
}
export async function validateUpdateAssets(assets: UpdateAsset[], version: string, real = false) {
  if (assets.length !== 3 || new Set(assets.map(a => a.kind)).size !== 3) throw new ApiError(400, 'INVALID_FILE_COUNT');
  for (const asset of assets) {
    if (real && (await stat(asset.path)).size !== asset.size) throw new ApiError(400, 'ASSET_SIZE_MISMATCH');
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
  if (real) await validateBlockmap(assets.find(a => a.kind === 'blockmap')!, installer);
  const digest512 = sha512.digest('base64');
  try {
    const doc = parseDocument(await readFile(metadata.path, 'utf8'), { uniqueKeys: true });
    if (doc.errors.length) throw new Error();
    const value = doc.toJS({ maxAliasCount: 0 });
    if (!value || value.version !== version || !Array.isArray(value.files) || value.files.length !== 1) throw new Error();
    const file = value.files[0];
    if (file.url !== installer.name || file.sha512 !== digest512 || file.size !== installer.size) throw new Error();
    if (real && value.path !== installer.name) throw new Error();
    if (value.path !== undefined && value.path !== installer.name) throw new Error();
    if (value.sha512 !== undefined && value.sha512 !== digest512) throw new Error();
  } catch { throw new ApiError(400, 'INVALID_UPDATE_METADATA'); }
  const digest256 = sha256.digest('hex');
  const summaries = await Promise.all(assets.map(async asset => {
    let hash256 = digest256, hash512 = digest512;
    if (asset.kind !== 'installer') {
      const h256 = createHash('sha256'), h512 = createHash('sha512');
      for await (const chunk of createReadStream(asset.path)) { h256.update(chunk); h512.update(chunk); }
      hash256 = h256.digest('hex'); hash512 = h512.digest('base64');
    }
    return { name: asset.name, kind: asset.kind, size: asset.size, sha256: hash256, sha512: hash512 };
  }));
  return { sha256: digest256, assets: summaries };
}

// NSIS external v2 blockmaps: gzip JSON, BLAKE2b-144 for every chunk.
async function validateBlockmap(asset: UpdateAsset, installer: UpdateAsset) {
  try {
    const value = JSON.parse(gunzipSync(await readFile(asset.path), { maxOutputLength: MAX_BLOCKMAP_BYTES }).toString('utf8'));
    if (value.version !== '2' || !Array.isArray(value.files) || value.files.length !== 1) throw new Error();
    const file = value.files[0];
    if (file.name !== 'file' || file.offset !== 0 || !Array.isArray(file.sizes) || !Array.isArray(file.checksums) || !file.sizes.length || file.sizes.length !== file.checksums.length) throw new Error();
    const handle = await open(installer.path, 'r');
    let offset = 0;
    try {
      for (let i = 0; i < file.sizes.length; i++) {
        const size = file.sizes[i];
        if (!Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024 || offset + size > installer.size) throw new Error();
        const bytes = Buffer.alloc(size);
        const result = await handle.read(bytes, 0, size, offset);
        if (result.bytesRead !== size || Buffer.from(blake2b(bytes, undefined, 18)).toString('base64') !== file.checksums[i]) throw new Error();
        offset += size;
      }
      if (offset !== installer.size) throw new Error();
    } finally { await handle.close(); }
  } catch { throw new ApiError(400, 'INVALID_BLOCKMAP'); }
}
