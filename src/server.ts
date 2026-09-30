import { loadEnv } from './config/env.js';
import { createDatabase } from './repositories/database.js';
import { loadSigningKeysFromEnv } from './utils/signature.js';
import { createApp } from './app.js';
import { logStartupConfiguration, logEnvValidationFailure, logSigningKeyFailure } from './config/startup.js';

async function main() {
  logStartupConfiguration();
  let env;
  try { env = loadEnv(); }
  catch (error) { logEnvValidationFailure(error); process.exitCode = 1; return; }
  let privateKey;
  try { ({ privateKey } = loadSigningKeysFromEnv(env)); }
  catch (error) { logSigningKeyFailure(error); process.exitCode = 1; return; }
  const db = createDatabase(env.DATABASE_URL);
  try { await db.$connect(); }
  catch {
    console.error('[STARTUP] Database connection failed');
    process.exitCode = 1;
    await db.$disconnect().catch(() => {});
    return;
  }
  const server = createApp({ db, env, privateKey }).listen(env.PORT, () => console.log(`central-licencas listening on port ${env.PORT}`));
  server.on('error', async () => { console.error('[STARTUP] Server listen failed'); process.exitCode = 1; await db.$disconnect().catch(() => {}); });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => { void db.$disconnect().finally(() => { clearTimeout(timeout); }); });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
main().catch(() => { console.error('[STARTUP] Initialization failed'); process.exitCode = 1; });
