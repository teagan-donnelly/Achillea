# Serving the local demo on your own domain

The app keeps running on the laptop. A named Cloudflare Tunnel connects your domain to the local Vite UI (which proxies `/api` to the Spring backend). No port forwarding, static IP or hosting account is needed, and it works on hackathon Wi-Fi.

```
https://achillea.yourdomain.tech → Cloudflare → tunnel → laptop :15274 (Vite UI) → /api → :18184 (Spring + H2)
```

## One-time setup

1. **Put the domain's DNS on Cloudflare (free).** dash.cloudflare.com → *Add a site* → enter the domain → *Free* plan. Cloudflare shows two nameservers. In GoDaddy: *My Products → domain → DNS → Nameservers → Change → "I'll use my own nameservers"*, paste both, save. Wait until Cloudflare shows the site as **Active** (minutes to a few hours). The domain stays registered at GoDaddy.
2. **Download cloudflared** (official Cloudflare binary) from the repository root:
   ```powershell
   New-Item -ItemType Directory -Force .demo-runtime | Out-Null
   curl.exe -fL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe -o .demo-runtime/cloudflared.exe
   ```
3. **Build once:** `mvn -f backend/pom.xml verify` and `cd frontend; npm ci; cd ..`

## Start

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-PublicDemo.ps1 -Hostname achillea.yourdomain.tech
```

The first run opens a browser to log in to Cloudflare (pick your domain), creates the tunnel `achillea`, and adds the DNS record. Later runs reuse them. It opens backend and frontend windows and runs the tunnel in the current one. Use the bare domain (`-Hostname yourdomain.tech`) if you prefer. Options: `-DatabaseName`, `-Deterministic` (no built-in fake monitor), `-TunnelName`.

Optional sample data: `node scripts/seed-sample-data.mjs --live`.

## Notes

- Keep the laptop awake and all three windows open; closing any of them takes the site down.
- The site is public with no login, and visitors can change synthetic demo records. Share only with judges/teammates and stop the tunnel afterwards. For a login gate, add a Cloudflare Zero Trust → Access application for the hostname (email one-time code).
- The hostname must match `-Hostname` exactly; Vite rejects other hosts.
- An external simulator can target `https://<your hostname>` as its `/api` proxy (with `changeOrigin: true`).
