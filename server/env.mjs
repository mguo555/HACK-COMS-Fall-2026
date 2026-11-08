// Loads the project's .env (if any) into process.env. Imported first by main.ts so later modules
// see the values. .env is git-ignored and holds SMTP credentials; it is only read on the server.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
  // On macOS/Linux, warn if other users on this machine could read the secrets.
  if (process.platform !== 'win32' && (statSync(envPath).mode & 0o077) !== 0) {
    console.warn('[server] warning: .env is readable by other users. Run: chmod 600 .env');
  }
}

// node:sqlite works fine but still prints an "experimental" warning on Node 22. Hide just that one.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  return emitWarning(warning, ...rest);
};
