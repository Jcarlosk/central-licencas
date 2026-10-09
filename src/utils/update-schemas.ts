import { z } from 'zod';
import semver from 'semver';
import { uuid, validationBody } from './schemas.js';

export const versionSchema = z.string().max(100).refine(v => semver.valid(v) === v && !v.includes('+'), 'SemVer canônico sem build metadata');
export const channelSchema = z.enum(['stable', 'beta']);
export const releaseBody = z.object({
  productId: uuid, version: versionSchema, channel: channelSchema,
  mandatory: z.boolean(), title: z.string().trim().min(1).max(200), notes: z.string().trim().max(10000),
}).strict().refine(v => v.channel !== 'stable' || !semver.prerelease(v.version), 'Stable não aceita prerelease');
export const checkBody = validationBody.extend({
  product: z.string().min(1).max(100), currentVersion: versionSchema, channel: channelSchema,
}).strict();
export type ReleaseInput = z.infer<typeof releaseBody>;
export type UpdateCheckInput = z.infer<typeof checkBody>;
export type UpdateCheckResponse = { updateAvailable: false } | {
  updateAvailable: true; version: string; channel: 'stable' | 'beta'; mandatory: boolean;
  title: string; notes: string; downloadUrl: string; sha256: string;
};
