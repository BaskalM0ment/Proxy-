const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { URL } = require('node:url');

// Prefer IPv4 inside Docker. Some hosts/networks advertise IPv6 but the
// container cannot actually route IPv6, which can otherwise cause upstream
// requests to fail and surface as 502 errors.
dns.setDefaultResultOrder('ipv4first');

const PORT = Number(process.env.PORT || 3000);
const MAX_REDIRECTS = 6;
const TIMEOUT_MS = 15000;

function validTarget(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;

  const host = url.hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost')
  ) {
    return null;
  }

  return url;
}

function fetchUrl(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      return reject(new Error('Too many redirects.'));
    }

    const url = validTarget(target);

    if (!url) {
      return reject(new Error('Invalid or unsupported URL.'));
    }

    const transport = url.protocol === 'https:' ? https : http;

    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname || '/'}${url.search || ''}`,
      method: 'GET',
      timeout: TIMEOUT_MS,
      family: 4,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'close'
      }
    };

    const req = transport.request(options, res => {
      const location = res.headers.location;

      if (location && [301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();

        let nextUrl;
        try {
          nextUrl = new URL(location, url).href;
        } catch {
          return reject(new Error('Invalid redirect URL.'));
        }

        return fetchUrl(nextUrl, redirects + 1)
          .then(resolve)
          .catch(reject);
      }

      const chunks = [];

      res.on('data', chunk => chunks.push(chunk));

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 200,
          headers: res.headers,
          body: Buffer.concat(chunks),
          url: url.href
        });
      });

      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy(new Error('Upstream request timed out.'));
    });

    req.on('error', reject);

    req.end();
  });
}

function proxied(value, base) {
  try {
    const url = new URL(value, base);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return value;
    }

    return '/proxy?url=' + encodeURIComponent(url.href);
  } catch {
    return value;
  }
}

function rewriteHtml(html, base) {
  html = html.replace(
    /\b(href|src|action|poster|data)\s*=\s*(["'])(.*?)\2/gi,
    (match, attr, quote, value) => {
      if (/^\s*(?:#|javascript:|mailto:|tel:|data:|blob:)/i.test(value)) {
        return match;
      }

      return `${attr}=${quote}${proxied(value, base)}${quote}`;
    }
  );

  html = html.replace(
    /\bsrcset\s*=\s*(["'])(.*?)\1/gi,
    (match, quote, value) => {
      const parts = value.split(',').map(item => {
        const p = item.trim().split(/\s+/);

        if (p[0]) {
          p[0] = proxied(p[0], base);
        }

        return p.join(' ');
      });

      return `srcset=${quote}${parts.join(', ')}${quote}`;
    }
  );

  html = html.replace(
    /<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy[^>]*>/gi,
    ''
  );

  html = html.replace(
    /<meta[^>]+http-equiv\s*=\s*["']?X-Frame-Options[^>]*>/gi,
    ''
  );

  return html;
}

function sendError(res, status, message) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(message);
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    );

    if (requestUrl.pathname !== '/proxy') {
      return sendError(res, 404, 'Not found.');
    }

    const target = requestUrl.searchParams.get('url');

    if (!target) {
      return sendError(res, 400, 'Missing url parameter.');
    }

    const result = await fetchUrl(target);

    let body = result.body;
    let contentType = result.headers['content-type'] || 'application/octet-stream';

    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      body = Buffer.from(
        rewriteHtml(body.toString('utf8'), result.url),
        'utf8'
      );

      contentType = 'text/html; charset=utf-8';
    }

    res.writeHead(result.statusCode, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(body);
  } catch (error) {
    console.error(`Proxy error: ${error.message}`);
    sendError(res, 502, `Proxy error: ${error.message}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy listening on ${PORT}`);
});
