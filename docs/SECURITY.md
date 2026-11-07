# API keys and security

The AI players call Claude with an Anthropic API key. That key can spend money, so it lives in
one place and never leaves the machine running the server.

## Where the key goes

Put it in **`.env` at the repo root**:

```bash
cp .env.example .env     # skip if .env already exists
chmod 600 .env           # only your user can read it (macOS/Linux)
# then edit .env:  ANTHROPIC_API_KEY=sk-ant-...
```

Restart `npm run dev` after changing it. The server log says
`Claude is reachable — AI players are live` when the key works.

Prefer not to keep a key in a file? Install the [`ant` CLI](https://platform.claude.com/docs) and
run `ant auth login`. The SDK picks up that login automatically; leave `ANTHROPIC_API_KEY` blank.

## What keeps it safe

| Protection                                                                                                                              | Where                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `.env` is git-ignored (only `.env.example`, which has no secrets, is committed)                                                         | `.gitignore`                             |
| Only the Node server reads the key; the browser never sees it. The Angular app talks to `/api/*`, and the server makes the Claude calls | `server/env.mjs`, `server/claude.mjs`    |
| `/api/health` reports only whether AI is on, the model name and a reason. It never returns the key                                      | `server/index.mjs`                       |
| The server warns at startup if `.env` is readable by other users                                                                        | `server/env.mjs`                         |
| The server listens on `127.0.0.1` only, so nobody else on the network (e.g. hackathon Wi-Fi) can use it to spend your credits           | `server/index.mjs` (`HOST`)              |
| POST requests must be `application/json`, so other websites open in your browser can't quietly call your local server                   | `server/index.mjs`                       |
| Request bodies are capped at 64 kB and chat messages at 280 characters                                                                  | `server/index.mjs`, `server/prompts.mjs` |

## Rules for contributors

- Never put the key in anything under `src/`. That code is bundled and shipped to the browser,
  where anyone can read it.
- Never paste the key into an issue, a PR, a chat or a screenshot.
- Don't set `HOST=0.0.0.0` unless you need other devices to reach the server, and turn it back off
  afterwards.
- If a key leaks, revoke it in the [Claude Console](https://platform.claude.com/) (API keys page),
  create a new one and update `.env`.

## Deploying somewhere else

Use the host's secret store (environment variables on Render, Fly.io, Railway, etc.), not a
committed file. Only the server process needs `ANTHROPIC_API_KEY`.
