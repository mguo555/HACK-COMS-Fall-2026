// Starts TheDailyStalk server. `npm run server` (or `npm run dev` for the server plus Angular).
import './env.mjs';
import { createApp } from './app';
import { loadConfig } from './config';

process.on('unhandledRejection', (error) => console.error('[server] unhandled rejection:', error));

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config).catch((error) => {
    console.error('[server] could not open the database:', error);
    process.exit(1);
  });

  app.server.on('error', (error) => {
    console.error(`[server] could not start on ${config.host}:${config.port}:`, error.message);
    process.exit(1);
  });

  app.server.listen(config.port, config.host, () => {
    console.log(`[server] listening on http://${config.host}:${config.port}`);
    console.log(
      app.database === 'postgres'
        ? `[server] database: Postgres at ${new URL(config.databaseUrl!).host}`
        : `[server] database: PGlite in ${config.dataDir}/pglite (set DATABASE_URL for Postgres)`,
    );
    console.log(`[server] photos in ${config.dataDir}/images`);
    if (config.staticDir) console.log(`[server] serving the site from ${config.staticDir}`);
    if (config.emailer) {
      console.log(
        `[server] sign-in codes go out through the emailer at ${new URL(config.emailer.url).host}`,
      );
    } else if (config.smtp) {
      console.log(`[server] sign-in codes go out over SMTP (${config.smtp.host})`);
    } else {
      console.log(
        '[server] no email set up: sign-in codes will print here instead of being emailed',
      );
    }
    if (!config.admins.size) {
      console.log('[server] no ADMIN_EMAILS set: nobody can use the mod queue');
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.close().then(() => process.exit(0));
    });
  }
}

main();
