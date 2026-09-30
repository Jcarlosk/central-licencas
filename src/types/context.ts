import type { PrismaClient } from '@prisma/client';
import type { KeyObject } from 'node:crypto';
import type { Env } from '../config/env.js';
export interface Context { db: PrismaClient; env: Env; privateKey: KeyObject; }
