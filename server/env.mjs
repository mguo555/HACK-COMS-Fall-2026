// Loads the project's .env (if any) into process.env. Imported first by index.mjs so that
// later modules see the values when they're evaluated.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
