import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { createDatabase } from '../src/repositories/database.js';
import { adminInput } from '../src/utils/schemas.js';
import { readAdminInput } from './input.js';
async function main() {
  const url = z.string().url().refine(v => /^postgres(ql)?:/.test(v)).parse(process.env.DATABASE_URL);
  const data = adminInput.parse(await readAdminInput());
  const db = createDatabase(url);
  try {
    await db.admin.create({ data: { name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 12) }, select: { id: true } });
    console.log('Administrador criado.');
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 'Email já cadastrado.' : 'Não foi possível criar admin. Confira DATABASE_URL e entrada (nome, email e senha de 12 caracteres, até 72 bytes).');
  process.exitCode = 1;
});
