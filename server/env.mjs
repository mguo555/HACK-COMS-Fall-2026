// Loads the project's .env (if any) into process.env. Imported first by index.mjs so that
// later modules see the values when they're evaluated.
//
// .env is where the Gemini API key lives. It is git-ignored and only ever read here, on the
// server: the key is never sent to the browser or written to logs.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
  // Treat a blank "GEMINI_API_KEY=" line as not set.
  for (const name of ['GEMINI_API_KEY']) {
    if (process.env[name]?.trim() === '') delete process.env[name];
  }
  // On macOS/Linux, warn if other users on this machine could read the key.
  if (process.platform !== 'win32' && (statSync(envPath).mode & 0o077) !== 0) {
    console.warn('[api] warning: .env is readable by other users. Run: chmod 600 .env');
  }
}
