// `npm run dev:tailnet`: like `npm run dev`, but the site is reachable from your other Tailscale
// devices, which is the easy way to try posting from your phone's camera roll.
//
// The web server binds to this machine's Tailscale IP only, so it is NOT reachable from the local
// Wi-Fi/LAN. The API server stays on 127.0.0.1; the web server forwards /api to it.
import { execFileSync } from 'node:child_process';
import concurrently from 'concurrently';

function tailscale(args) {
  return execFileSync('tailscale', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let ip;
let dnsName;
try {
  ip = tailscale(['ip', '-4']).trim().split('\n')[0];
  dnsName = JSON.parse(tailscale(['status', '--json'])).Self?.DNSName?.replace(/\.$/, '');
} catch {
  console.error('Tailscale is not installed or not connected. Run `tailscale up` and try again.');
  process.exit(1);
}
if (!/^100\.\d+\.\d+\.\d+$/.test(ip)) {
  console.error(`Unexpected Tailscale IP "${ip}". Is Tailscale connected?`);
  process.exit(1);
}

const port = Number(process.env.WEB_PORT) || 4200;

console.log('\nOpen TheDailyStalk from any device on your tailnet:');
if (dnsName) console.log(`  http://${dnsName}:${port}`);
console.log(`  http://${ip}:${port}\n`);

const { result } = concurrently(
  [
    { command: 'npm run server', name: 'api', prefixColor: 'magenta' },
    // The "tailnet" serve configuration in angular.json allows *.ts.net Host headers, so the
    // MagicDNS name works (the CLI flag only accepts true/false, i.e. "allow every host").
    {
      command: `ng serve --configuration tailnet --host ${ip} --port ${port}`,
      name: 'web',
      prefixColor: 'cyan',
    },
  ],
  { killOthersOn: ['failure', 'success'] },
);
result.catch(() => process.exit(1));
