/**
 * Cloudflare Worker — TuneFriend web app + Subsonic CORS proxy
 *
 * Serves static assets from ASSETS binding.
 * Proxies /api/proxy?server=...&endpoint=... to the user's music server
 * (same role as server.py on localhost:8765).
 */

const MAX_PROXY_URL_LEN = 4000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range, Authorization",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    ...extra,
  };
}

function isValidEndpoint(endpoint) {
  return typeof endpoint === "string" && /^[a-zA-Z0-9]+\.view$/.test(endpoint);
}

function isRawIpHost(host) {
  // IPv4 or [IPv6]
  const h = String(host || "").replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":")) return true; // rough IPv6
  return false;
}

function isValidServer(server) {
  if (!server || typeof server !== "string") return false;
  if (server.length > 500) return false;
  try {
    const u = new URL(server);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    // Cloudflare Workers cannot fetch() by raw IP (error 1003).
    if (isRawIpHost(host)) return "raw-ip";
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("169.254.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      // Private LAN — Workers cannot reach home networks.
      return "private";
    }
    return true;
  } catch {
    return false;
  }
}

async function handleProxy(request, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed" }, 405);
  }

  const server = (url.searchParams.get("server") || "").replace(/\/+$/, "");
  const endpoint = url.searchParams.get("endpoint") || "";

  if (!server || !endpoint) {
    return json({ error: "Missing server or endpoint" }, 400);
  }
  if (!isValidEndpoint(endpoint)) {
    return json({ error: "Invalid endpoint" }, 400);
  }

  const serverOk = isValidServer(server);
  if (serverOk === "raw-ip") {
    return json(
      {
        error:
          "Cloudflare cannot connect using a raw IP address. " +
          "In Cloudflare DNS, add an A record (e.g. music.tunefriend.org → your server IP) with Proxy OFF (grey cloud), " +
          "then use http://music.tunefriend.org:4533 as the Server URL (proxy ON).",
      },
      400
    );
  }
  if (serverOk === "private") {
    return json(
      {
        error:
          "Your music server is on a private/LAN address. Cloudflare cannot reach it. " +
          "Use a public hostname, Cloudflare Tunnel / Tailscale Funnel, " +
          "or run TuneFriend locally with ./start.sh on your PC.",
      },
      400
    );
  }
  if (!serverOk) {
    return json({ error: "Invalid server URL" }, 400);
  }

  const proxyParams = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (k === "server" || k === "endpoint") continue;
    proxyParams.set(k, v);
  }

  const target = `${server}/rest/${endpoint}?${proxyParams.toString()}`;
  if (target.length > MAX_PROXY_URL_LEN) {
    return json({ error: "Request too large" }, 400);
  }

  try {
    const headers = {
      "User-Agent": "TuneFriend/1.0 (Cloudflare Worker)",
    };
    const range = request.headers.get("Range");
    if (range) headers.Range = range;

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      // Allow longer streams (music)
      redirect: "follow",
    });

    const out = new Headers(corsHeaders());
    const pass = [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Accept-Ranges",
      "Last-Modified",
      "ETag",
    ];
    for (const h of pass) {
      const val = upstream.headers.get(h);
      if (val) out.set(h, val);
    }
    out.set("Cache-Control", "no-cache");

    // Stream body through (do not buffer whole tracks in memory)
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  } catch (e) {
    return json(
      { error: `Cannot reach music server: ${e?.message || String(e)}` },
      502
    );
  }
}

/**
 * Proxy AcoustID lookup so the app key can live as a Worker secret (ACOUSTID_CLIENT).
 * Query: fingerprint, duration, optional client (overrides secret).
 */
async function handleAcoustId(request, url, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed" }, 405);
  }

  const fingerprint = url.searchParams.get("fingerprint") || "";
  const duration = url.searchParams.get("duration") || "";
  const client =
    (url.searchParams.get("client") || "").trim() ||
    (env.ACOUSTID_CLIENT || "").trim();

  if (!fingerprint) {
    return json({ error: "Missing fingerprint" }, 400);
  }
  if (!client) {
    return json(
      {
        error:
          "AcoustID client not configured. Set Worker secret ACOUSTID_CLIENT, or pass client= from Settings (free key at acoustid.org/new-application).",
      },
      400
    );
  }

  const target = new URL("https://api.acoustid.org/v2/lookup");
  target.searchParams.set("client", client);
  target.searchParams.set("meta", "recordings+releasegroups+compress");
  target.searchParams.set("fingerprint", fingerprint);
  target.searchParams.set("duration", String(Math.round(Number(duration)) || 1));

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: { "User-Agent": "TuneFriend/1.0 (Cloudflare Worker AcoustID)" },
    });
    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return json(
      { error: `AcoustID unreachable: ${e?.message || String(e)}` },
      502
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, app: "TuneFriend", host: "cloudflare" });
    }

    if (url.pathname === "/api/proxy") {
      return handleProxy(request, url);
    }

    if (url.pathname === "/api/acoustid") {
      return handleAcoustId(request, url, env);
    }

    // Static app (SPA)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Assets not configured", { status: 500 });
  },
};
