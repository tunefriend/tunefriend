# Deploy TuneFriend on Cloudflare (always online)

Same pattern as **oncall-scheduler**: Cloudflare Worker + static assets + edge API.

## Live URL

**Primary:** **https://tunefriend.org**  
**Also:** https://www.tunefriend.org  
**Also:** https://tunefriend.tunefriend-schedules.workers.dev  

All three hit the same Worker. Your PC does **not** need to stay on.

## Redeploy after code changes

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
cd /home/james/grokApps/tunefriend

# Refresh public/ from app sources
./scripts/build-public.sh

npx wrangler deploy
```

## Important: music server URL on the web app

Cloudflare Workers **cannot**:

1. Reach **raw IP addresses** (e.g. `http://66.x.x.x:4533`) — fails with error 1003  
2. Reach **private LAN** IPs (`192.168.x.x`)

### Recommended: hostname under tunefriend.org

1. Cloudflare dashboard → **tunefriend.org** → **DNS** → **Add record**  
2. Type: **A**  
3. Name: **music**  
4. IPv4: **your Navidrome public IP** (e.g. `66.148.39.141`)  
5. **Proxy status: DNS only (grey cloud)** — not orange  
6. Save  

Then in TuneFriend login:

- **Server URL:** `http://music.tunefriend.org:4533`  
- **Use built-in proxy:** **ON** (required on the HTTPS site)  
- Username / password as usual  

| Server URL | Works on Cloudflare web? |
|------------|---------------------------|
| `http://music.tunefriend.org:4533` (A record, grey cloud) | Yes |
| `https://music.yourdomain.com` | Yes |
| Cloudflare Tunnel / Tailscale Funnel | Yes |
| `http://66.x.x.x:4533` (raw IP) | **No** |
| `http://192.168.x.x:4533` | **No** (use local `./start.sh`) |


## Local only (PC must stay on)

```bash
cd /home/james/grokApps/tunefriend
./start.sh
# http://127.0.0.1:8765
```

LAN private Navidrome works with the local server.

## Custom domain

Already linked:

- **https://tunefriend.org**
- **https://www.tunefriend.org**

Configured in `wrangler.toml` as Worker custom domains (same pattern as oncall-scheduler.us).

If a brand-new domain shows “can’t resolve” for a while, that’s normal DNS propagation for `.org` (often minutes to a few hours after registration). The workers.dev URL works immediately.
