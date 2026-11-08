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

Needs Node 22.13 or newer (it uses Node's built-in SQLite) and npm 11.

```bash
npx npm@11 install
npm run dev
```

Open http://localhost:4200. Sign in with any RIT-style email like `abc1234@rit.edu`. Without
email set up, the code shows up in the terminal running the server:

```
[mail] no SMTP set up. Sign-in code for abc1234@rit.edu: 482913
```

To try it on your phone, run `npm run dev:tailnet` and open the printed address on any device
on your Tailscale network.

## Commands

| Command               | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| `npm run dev`         | API server (3001) and Angular dev server (4200)              |
| `npm run dev:tailnet` | Same, reachable from your other Tailscale devices            |
| `npm run server`      | API server only. Also serves the built site, if there is one |
| `npm test`            | Unit tests and end-to-end API tests                          |
| `npm run typecheck`   | Type-check the app and the server                            |
| `npm run build`       | Production build into `dist/daily-stalk/browser`             |

## Running it for real

1. Copy `.env.example` to `.env` (`chmod 600 .env`) and set up SMTP so codes get emailed. Any
   SMTP account works. A Gmail account with an
   [app password](https://myaccount.google.com/apppasswords) is the quickest. RIT's Outlook may
   put the first few emails in junk.
2. Set `ADMIN_EMAILS` to the RIT emails of whoever moderates, and `PUBLIC_URL` to the site's
   address.
3. `npm run build`, then `npm run server`. The server serves the site and the API on one port
   (3001 by default).
4. Put it behind a reverse proxy with HTTPS (Caddy is the least work), set `HOST=0.0.0.0` only
   if the proxy is on another machine, and `TRUST_PROXY=true` so rate limits see real IPs.

Everything lives in `.data/`: the database (`stalk.db`) and the photos (`images/`). Back that
folder up.

## Deploying to a server with Docker

```bash
scripts/deploy.sh user@host 5001
```

This sends the committed code over SSH, builds a Docker image on the server, and runs it with
`--restart unless-stopped` on the port you give it. On the server everything is in
`~/thedailystalk`: `data/` holds the database and photos (kept across deploys, back it up) and
`.env` holds settings like SMTP and `ADMIN_EMAILS`. After editing `.env` there, run
`sudo docker restart thedailystalk`. Logs, including sign-in codes when SMTP isn't set up:
`sudo docker logs -f thedailystalk`.

### Putting it on a domain with Cloudflare Tunnel

The homelab's IP changes often, so instead of DNS records pointing at it, a Cloudflare Tunnel
connector runs next to the site and connects out to Cloudflare. Nothing needs to be forwarded on
the router.

1. Cloudflare dashboard: Zero Trust, Networks, Tunnels, create a Cloudflared tunnel and copy
   the token from the install command (don't run the command).
2. Save it on the server as `~/thedailystalk/tunnel.env` containing `TUNNEL_TOKEN=...`
   (`chmod 600`), then start the connector:
   ```bash
   sudo docker run -d --name stalk-tunnel --restart unless-stopped --network host \
     --env-file ~/thedailystalk/tunnel.env cloudflare/cloudflared:2026.10.7 \
     tunnel --no-autoupdate --edge-ip-version 4 run
   ```
3. In the tunnel's routes (public hostnames), send `stalk.photo` to HTTP `localhost:5001`.
   Delete any old DNS records for that name first.
4. In `~/thedailystalk/.env` set `PUBLIC_URL=https://stalk.photo` and `TRUST_PROXY=true`, then
   redeploy or restart.

## How it's built

Angular 21 in the browser, a small Node server with no framework, SQLite for data, and
[sharp](https://sharp.pixelplumbing.com/) to process photos. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SECURITY.md](docs/SECURITY.md).

## The old project

This repo used to hold "Will AI Beat Us?", a poker game against Gemini. It's saved on the
`archive/will-ai-beat-us` branch and the `will-ai-beat-us-final` tag.
