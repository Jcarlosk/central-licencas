import type { Prisma, UpdateRelease } from '@prisma/client';

// Keep current operational fields at the root for existing Admin/updater readers.
// Archive replaced fields without nesting the entire audit trail on every write.
export function replacePublicationLog(previous: Prisma.JsonValue | null, next: Prisma.InputJsonObject): Prisma.InputJsonObject {
  const object = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const { history, reactivations, ...operational } = object;
  const entries: (Prisma.InputJsonValue | null)[] = Array.isArray(history) ? [...history] : [];
  const archived = Array.isArray(previous) || typeof previous !== 'object' ? previous : operational;
  if (archived !== null && (typeof archived !== 'object' || Object.keys(archived).length)) {
    entries.push({ at: new Date().toISOString(), log: archived });
  }
  // Preserve unexpected legacy values too, rather than silently discarding them.
  if (history !== undefined && !Array.isArray(history)) entries.push({ legacyHistory: history });
  return { ...next, history: entries, ...(reactivations !== undefined ? { reactivations } : {}) };
}

export function reactivationPublicationLog(release: UpdateRelease, adminId: string): Prisma.InputJsonObject {
  const result = replacePublicationLog(release.publicationLog, { mode: 'DRAFT', steps: ['REACTIVATED_AS_DRAFT'] });
  const { publicationLog: _previous, ...snapshot } = release;
  const previous = result.reactivations;
  return { ...result, reactivations: [
    ...(Array.isArray(previous) ? previous : previous === undefined ? [] : [{ legacyReactivations: previous }]),
    { at: new Date().toISOString(), adminId, reason: 'admin_reactivation', previousStatus: 'DISABLED', snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue },
  ] };
}
