# API key, usage limits and security

The AI players run on Google Gemini. The Gemini API key is tied to your Google account, so it
lives in one place and never leaves the machine running the server.

## Where the key goes

Put it in **`.env` at the repo root**:

```bash
cp .env.example .env     # skip if .env already exists
chmod 600 .env           # only your user can read it (macOS/Linux)
# then edit .env:  GEMINI_API_KEY=your-key
```

Get a key from [Google AI Studio](https://aistudio.google.com/) under "Get API key". Restart
`npm run dev` after changing it. The server log names the model and today's call count when the
key works.

## What keeps it safe

| Protection                                                                                                            | Where                                    |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `.env` is git-ignored. Only `.env.example`, which has no secrets, is committed                                        | `.gitignore`                             |
| Only the Node server reads the key. The browser talks to `/api/*` and never sees it                                   | `server/env.mjs`, `server/gemini.mjs`    |
| `/api/health` returns whether AI is on, the model name, a reason and usage counts. Never the key                      | `server/index.mjs`                       |
| The server warns at startup if `.env` is readable by other users                                                      | `server/env.mjs`                         |
| The server listens on `127.0.0.1` only, so nobody else on the network (e.g. hackathon Wi-Fi) can use your quota       | `server/index.mjs` (`HOST`)              |
| POST requests must be `application/json`, so other websites open in your browser can't quietly call your local server | `server/index.mjs`                       |
| Request bodies are capped at 64 kB and chat messages at 280 characters                                                | `server/index.mjs`, `server/prompts.mjs` |

## Keeping usage low (free tier)

The key is on Google's free tier, so the game is built to make few calls:

- **Hard caps:** at most 8 Gemini calls per minute and 200 per day (`POKER_GEMINI_PER_MINUTE`,
  `POKER_GEMINI_PER_DAY` in `.env`). The daily count is saved in `.data/ai-usage.json`, so
  restarting the server doesn't reset it. Failed calls count too.
- **Backoff:** if Google says it's busy or out of quota (HTTP 429/503), the server stops calling
  for 30 seconds.
- **Stops on bad config:** if Google rejects the key or the model, the server stops calling
  until it restarts.
- **No hidden retries:** the SDK's automatic retries stay off, so one game action is at most one
  API call.
- **Small requests:** Flash-Lite model, low thinking, replies capped at 1024 tokens. A typical
  call is about 900 tokens in and 70 out.
- **Fewer calls per round:** chat replies always use Gemini. A bot's moves use Gemini only in
  rounds where you've messaged that bot; other moves use the built-in poker logic
  (`aiDecisions` in `src/app/game/game.config.ts`).

When a cap is hit, the bots keep playing with the built-in logic and the page shows a short note.

## Rules for contributors

- Never put the key in anything under `src/`. That code is bundled and shipped to the browser,
  where anyone can read it.
- Never paste the key into an issue, a PR, a chat or a screenshot.
- Don't set `HOST=0.0.0.0` unless you need other devices to reach the server, and turn it back off
  afterwards.
- If a key leaks, delete it in Google AI Studio (API keys page), create a new one and update
  `.env`.

## Deploying somewhere else

Use the host's secret store (environment variables on Render, Fly.io, Railway, etc.), not a
committed file. Only the server process needs `GEMINI_API_KEY`.
