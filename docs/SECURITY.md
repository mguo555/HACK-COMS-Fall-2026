# Security and privacy

## Who can get in

- Sign-up is limited to `@rit.edu` and `@g.rit.edu` addresses whose username looks like an RIT
  username (`abc1234`). Both are settings (`EMAIL_DOMAINS`, `EMAIL_USERNAME_PATTERN`).
- The domain check alone can't tell students from staff. The username pattern narrows it a lot,
  but if you need a hard "students only" guarantee, that would take RIT's directory or SSO.
- Proof of email is a 6-digit code: random, stored only as a salted SHA-256 hash, valid for 10
  minutes, 5 wrong tries and it's dead. Codes beat magic links here because Outlook's link
  scanner opens links in RIT mail before the student does.
- Rate limits: one code per address per minute, 6 per hour; 20 code emails and 60 code checks
  per IP per hour; 300 POSTs per IP per minute; 600 likes per person per hour.

## Behind Cloudflare

- The public site runs through a Cloudflare Tunnel, so the homelab has no open ports and its IP
  never appears in DNS. Visitors get HTTPS from Cloudflare.
- With `TRUST_PROXY=true`, rate limits key on Cloudflare's `CF-Connecting-IP` header. Don't turn
  that on for a server people can reach directly, or they could fake the header.

## The server

- Only the Cloudflare Tunnel connector talks to the outside, and it connects outward. No ports
  are open on the router; the site listens on the server's loopback only (127.0.0.1:5001), and
  Postgres isn't published at all, only the app container can reach it.
- With `PUBLIC_URL` on https, requests that come through Cloudflare over `http://` or to `www.`
  are redirected to `https://stalk.photo`, and responses carry HSTS (180 days).
- The database password is random, made on first deploy, and kept in `~/thedailystalk/.env`
  (mode 600). Nightly dumps go to `~/thedailystalk/backups`.

## Sessions

- A random 32-byte token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `PUBLIC_URL` is
  https). The database stores only its SHA-256, so a leaked database doesn't leak sessions.
- Sessions last 30 days from last use: using the site more than a day after the last refresh
  pushes the expiry out again. Signing out deletes the session; a ban deletes all of them.

## Requests from other sites (CSRF)

- `SameSite=Lax` keeps the cookie off cross-site POSTs.
- Every POST must be `application/json` or `image/*`, which browsers can't send cross-site
  without a CORS preflight, and the server never answers preflights.
- POSTs with an `Origin` header that doesn't match the site are refused.

## Uploads

- Every photo is decoded and re-encoded with sharp, so what we serve is always a WebP we made.
  That strips EXIF data (GPS location, camera serials) and anything hidden in the file.
- Videos and animated images are refused. Uploads are capped at 15 MB and 100 megapixels.
- Image files are served with `nosniff`, through a route that checks the post's status, so a
  hidden or deleted photo isn't reachable by URL. With `MEMBERS_ONLY` (the default), photos need
  a signed-in session.

## The site itself

- The built site is served with a Content Security Policy that only allows our own scripts and
  Google Fonts, plus `frame-ancestors 'none'`, `nosniff` and `Referrer-Policy: same-origin`.
  (`inlineCritical` is off in `angular.json` because its inline `onload` would break under CSP.)
- Angular escapes everything it renders. There's no user text besides handles, which are limited
  to `a-z`, `0-9` and `_`.

## Moderation

- Reports are one per person per photo. `REPORTS_TO_HIDE` (3) reports hide a photo until a mod
  keeps or removes it. Mods are listed in `ADMIN_EMAILS` and see the reporter count and the
  poster's email in the mod queue.
- A ban takes down every photo from that account, signs it out everywhere, and blocks new codes
  for that email.

## Secrets

- Sign-in codes go out through the team's emailer service (`EMAILER_URL`) over HTTPS, or SMTP.
  The emailer currently accepts requests from anyone; giving it a shared key and setting
  `EMAILER_KEY` here (sent as a Bearer token) would stop others from sending mail through it.
- `.env` (SMTP password or emailer key) is git-ignored and read only by the server. The server warns at startup
  if other users on the machine can read it.
- `.data/` (database and photos) is git-ignored. Back it up, and treat it as private: it has
  every student's email.
