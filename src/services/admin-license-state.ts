import type { License } from '@prisma/client';
import { DAY_MS, licenseStatus } from './license-policy.js';

// Calendar labels use the Central's explicit business timezone, never the host timezone.
const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' });
function day(value: Date) {
  const parts = calendar.formatToParts(value);
  const part = (name: string) => Number(parts.find(p => p.type === name)!.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS;
}
export function calcularEstadoLicencaAdmin(license: Pick<License, 'status' | 'startsAt' | 'expiresAt' | 'graceUntil'>, agora = new Date(), enabled = true) {
  const status = licenseStatus(license, agora, enabled);
  const valid = [agora, license.startsAt, license.expiresAt, license.graceUntil].every(d => Number.isFinite(d.getTime()));
  const diasParaVencer = valid ? day(license.expiresAt) - day(agora) : null;
  const diasCarenciaRestantes = valid ? Math.max(0, day(license.graceUntil) - day(agora)) : null;
  const base = { status, diasParaVencer, diasCarenciaRestantes, critico: false };
  if (status === 'REVOKED') return { ...base, nivel: 'REVOKED', label: 'Revogada' };
  if (status === 'SUSPENDED') return { ...base, nivel: 'SUSPENDED', label: 'Suspensa' };
  if (!valid) return { ...base, nivel: 'INVALID', label: 'Datas inválidas' };
  if (status === 'EXPIRED') return { ...base, nivel: 'EXPIRED', label: agora < license.startsAt ? 'Ainda não iniciada' : 'Expirada' };
  if (status === 'GRACE') {
    const remaining = diasCarenciaRestantes!;
    return { ...base, nivel: remaining <= 3 ? 'CRITICAL' : 'GRACE', critico: remaining <= 3, label: remaining === 0 ? 'Último dia de carência' : `Carência · ${remaining} ${remaining === 1 ? 'dia' : 'dias'}` };
  }
  const days = diasParaVencer!;
  return { ...base, nivel: days === 0 ? 'TODAY' : days <= 7 ? 'SOON' : 'ACTIVE', label: days === 0 ? 'Vence hoje' : days === 1 ? 'Vence amanhã' : days <= 7 ? `Vence em ${days} dias` : 'Ativa' };
}
