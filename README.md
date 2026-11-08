# TheDailyStalk

A photo board for RIT students. Every day there's one theme, and everyone gets to post one
photo for it. No videos, no captions, no text posts. Just the photo, and likes.

- **One photo a day.** The day runs midnight to midnight, Rochester time. Deleting your photo
  doesn't give you another try.
- **RIT students only.** You sign in with your RIT email (`abc1234@rit.edu`). We email you a
  6-digit code; there are no passwords.
- **A daily theme list.** The theme rotates through a list in
  [`src/app/shared/themes.ts`](src/app/shared/themes.ts), with special days pinned. The Themes
  page shows the week ahead and every past day.
- **Likes.** A leaf on every photo. You can't like your own.
- **Your plant.** Your profile shows a potted plant that grows every day you post in a row and
  flowers at two weeks. Miss a day and it's back to a seed.
- **Moderation.** Anyone can report a photo. Three reports hide it until a mod keeps or removes
  it. Mods can ban accounts.

## Quick start

Needs Node 22.13 or newer and npm 11. Nothing else: in development the database is PGlite (real
Postgres compiled to run inside Node), stored in `.data/pglite`.

```bash
npx npm@11 install
npm run dev
```

Open http://localhost:4200. Sign in with any RIT-style email like `abc1234@rit.edu`. Without
email set up, the code shows up in the terminal running the server:

```
[mail] no email set up. Sign-in code for abc1234@rit.edu: 482913
```

To try it on your phone, run `npm run dev:tailnet` and open the printed address on any device
on your Tailscale network.

## Commands

| Command                            | What it does                                                 |
| ---------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                      | API server (3001) and Angular dev server (4200)              |
| `npm run dev:tailnet`              | Same, reachable from your other Tailscale devices            |
| `npm run server`                   | API server only. Also serves the built site, if there is one |
| `npm test`                         | Unit tests and end-to-end API tests (on PGlite)              |
| `npm run typecheck`                | Type-check the app and the server                            |
| `npm run build`                    | Production build into `dist/daily-stalk/browser`             |
| `npm run deploy -- user@host 5001` | Deploy to a server (see below)                               |

To run the tests on a real Postgres server instead of PGlite, set
`TEST_DATABASE_URL=postgres://user:pass@host:5432/db`. Each test file makes its own database.

## Production

stalk.photo runs on a homelab server as a Docker Compose stack (`compose.yaml`):

- **db**: Postgres 17. Only the app can reach it.
- **app**: the site and API, on port 5001, reachable only from the server itself.
- **tunnel**: the Cloudflare Tunnel connector. Cloudflare sends stalk.photo traffic down the
  tunnel to the app, so the home IP can change and no router ports are open.

Deploy the committed code with:

```bash
npm run deploy -- saksham@100.91.45.86 5001
```

It builds on the server and restarts what changed. On the server, everything is in
`~/thedailystalk`:

| Path          | What's there                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `app/`        | The code, replaced on every deploy                                                                                   |
| `.env`        | Settings: `PUBLIC_URL`, `TRUST_PROXY`, `EMAILER_URL`, `ADMIN_EMAILS`, and `POSTGRES_PASSWORD` (made on first deploy) |
| `tunnel.env`  | `TUNNEL_TOKEN` for the Cloudflare Tunnel                                                                             |
| `postgres/`   | The database files                                                                                                   |
| `data/images` | Uploaded photos                                                                                                      |
| `backups/`    | Nightly database dumps at 4:30 AM, 14 days kept                                                                      |

Handy commands on the server, from `~/thedailystalk`:

```bash
alias stalk='sudo docker compose -f app/compose.yaml --env-file .env --profile tunnel'
stalk ps                      # what's running
stalk logs -f app             # the site's log
stalk up -d --no-deps app     # after editing .env (restart alone keeps the old settings)
stalk exec db psql -U stalk   # a database shell
sudo systemctl start stalk-backup.service   # back up right now
```

Restore a backup with
`stalk exec -T db pg_restore -U stalk -d stalk --clean --if-exists < backups/stalk-YYYY-MM-DD.dump`.
The dumps don't include photos; copy `data/images` somewhere else too.

### Setting up the domain from scratch

1. Cloudflare dashboard: Zero Trust, Networks, Tunnels, create a Cloudflared tunnel and copy
   the token from its install command (don't run the command). Save it on the server as
   `~/thedailystalk/tunnel.env` containing `TUNNEL_TOKEN=...` (`chmod 600`).
2. In the tunnel's routes, send `stalk.photo` to HTTP `localhost:5001`. Delete any old DNS
   records for that name first, or Cloudflare can't add the tunnel's.
3. In `~/thedailystalk/.env` set `PUBLIC_URL=https://stalk.photo`, `TRUST_PROXY=true` and
   `EMAILER_URL=https://emailer.aceiq.ca/send-email`, then deploy.

With `PUBLIC_URL` on https, the server sends `http://` and `www.` visitors to
`https://stalk.photo` itself, so sign-in cookies always land on the same address.

## How it's built

Angular 21 in the browser, a small Node server with no framework, Postgres for data, and
[sharp](https://sharp.pixelplumbing.com/) to process photos. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SECURITY.md](docs/SECURITY.md).

## The old project

This repo used to hold "Will AI Beat Us?", a poker game against Gemini. It's saved on the
`archive/will-ai-beat-us` branch and the `will-ai-beat-us-final` tag.
