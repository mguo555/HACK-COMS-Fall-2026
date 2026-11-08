// Starts TheDailyStalk server. `npm run server` (or `npm run dev` for the server plus Angular).
import './env.mjs';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config);

app.server.on('error', (error) => {
  console.error(`[server] could not start on ${config.host}:${config.port}:`, error.message);
  process.exit(1);
});

process.on('unhandledRejection', (error) => console.error('[server] unhandled rejection:', error));

app.server.listen(config.port, config.host, () => {
  console.log(`[server] listening on http://${config.host}:${config.port}`);
  console.log(`[server] data in ${config.dataDir}`);
  if (config.staticDir) console.log(`[server] serving the site from ${config.staticDir}`);
  if (!config.smtp) {
    console.log('[server] no SMTP set up: sign-in codes will print here instead of being emailed');
  }
  if (!config.admins.size)
    console.log('[server] no ADMIN_EMAILS set: nobody can use the mod queue');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
