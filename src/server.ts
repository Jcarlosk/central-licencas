import { loadEnv } from './config/env.js';
import { createDatabase } from './repositories/database.js';
import { loadSigningKeysFromEnv } from './utils/signature.js';
import { createApp } from './app.js';

async function main() {
  const env = loadEnv();
  const { privateKey } = loadSigningKeysFromEnv(env);
  const db = createDatabase(env.DATABASE_URL);
  await db.$connect();
  const server = createApp({ db, env, privateKey }).listen(env.PORT, () => console.log(`central-licencas listening on port ${env.PORT}`));
  server.on('error', async () => { console.error('Server failed to listen'); await db.$disconnect(); process.exitCode = 1; });
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
main().catch(() => { console.error('Startup failed. Check environment, PostgreSQL and signing keys.'); process.exitCode = 1; });
