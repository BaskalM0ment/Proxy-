const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

dns.setDefaultResultOrder('ipv4first');

const PORT = Number(process.env.PORT || 3000);
const MAX_REDIRECTS = 6;
const TIMEOUT_MS = 15000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const USER_AGENT = process.env.PROXY_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);

function send(res, status, headers, body, headOnly = false) {
  res.writeHead(status, headers);
  res.end(headOnly ? undefined : body);
}

function sendText(res, status, message, headOnly = false) {
  send(res, status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, message, headOnly);
}

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
  ) return null;

  return url;
}

function fetchUrl(target, method = 'GET', redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('Too many redirects.'));

    const url = validTarget(target);
    if (!url) return reject(new Error('Invalid or unsupported URL.'));

    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname || '/'}${url.search || ''}`,
      method,
      timeout: TIMEOUT_MS,
      family: 4,
      headers: {
        'User-Agent': USER_AGENT,
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
        let next;
        try { next = new URL(location, url).href; }
        catch { return reject(new Error('Invalid redirect URL.')); }
        const nextMethod = res.statusCode === 303 ? 'GET' : method;
        return fetchUrl(next, nextMethod, redirects + 1).then(resolve, reject);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode || 200,
        headers: res.headers,
        body: Buffer.concat(chunks),
        url: url.href
      }));
      res.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('Upstream request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

function proxied(value, base) {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    return '/proxy?url=' + encodeURIComponent(url.href);
  } catch {
    return value;
  }
}

function rewriteHtml(html, base) {
  html = html.replace(
    /\b(href|src|action|poster|data)\s*=\s*(["'])(.*?)\2/gi,
    (match, attr, quote, value) => {
      if (/^\s*(?:#|javascript:|mailto:|tel:|data:|blob:)/i.test(value)) return match;
      return `${attr}=${quote}${proxied(value, base)}${quote}`;
    }
  );

  html = html.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (match, quote, value) => {
    const parts = value.split(',').map(item => {
      const p = item.trim().split(/\s+/);
      if (p[0]) p[0] = proxied(p[0], base);
      return p.join(' ');
    });
    return `srcset=${quote}${parts.join(', ')}${quote}`;
  });

  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy[^>]*>/gi, '');
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?X-Frame-Options[^>]*>/gi, '');
  return html;
}

function rewriteCss(css, base) {
  css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
    if (/^\s*(?:#|data:|blob:)/i.test(value)) return match;
    const rewritten = proxied(value, base);
    const q = quote || '"';
    return `url(${q}${rewritten}${q})`;
  });

  return css.replace(/@import\s+(["'])(.*?)\1/gi, (match, quote, value) => {
    return `@import ${quote}${proxied(value, base)}${quote}`;
  });
}

function serveStatic(pathname, req, res) {
  const entry = STATIC_FILES.get(pathname);
  if (!entry) return false;

  const [filename, contentType] = entry;
  try {
    const body = fs.readFileSync(path.join(PUBLIC_DIR, filename));
    send(res, 200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    }, body, req.method === 'HEAD');
  } catch (error) {
    console.error(`Static file error: ${error.message}`);
    sendText(res, 500, 'Frontend file unavailable.', req.method === 'HEAD');
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const headOnly = req.method === 'HEAD';

  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return sendText(res, 405, 'Method not allowed.', headOnly);
  }

  let requestUrl;
  try {
    requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendText(res, 400, 'Invalid request URL.', headOnly);
  }

  if (requestUrl.pathname === '/health') {
    return sendText(res, 200, 'ok', headOnly);
  }

  if (serveStatic(requestUrl.pathname, req, res)) return;

  if (requestUrl.pathname !== '/proxy') {
    return sendText(res, 404, 'Not found.', headOnly);
  }

  const target = requestUrl.searchParams.get('url');
  if (!target) return sendText(res, 400, 'Missing url parameter.', headOnly);

  try {
    const result = await fetchUrl(target, headOnly ? 'HEAD' : 'GET');
    let body = result.body;
    let contentType = result.headers['content-type'] || 'application/octet-stream';

    if (!headOnly && /text\/html|application\/xhtml\+xml/i.test(contentType)) {
      body = Buffer.from(rewriteHtml(body.toString('utf8'), result.url), 'utf8');
      contentType = 'text/html; charset=utf-8';
    } else if (!headOnly && /text\/css/i.test(contentType)) {
      body = Buffer.from(rewriteCss(body.toString('utf8'), result.url), 'utf8');
      contentType = 'text/css; charset=utf-8';
    }

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    };

    if (result.headers['content-disposition']) {
      headers['Content-Disposition'] = result.headers['content-disposition'];
    }

    send(res, result.statusCode, headers, body, headOnly);
  } catch (error) {
    console.error(`Proxy error: ${error.message}`);
    sendText(res, 502, `Proxy error: ${error.message}`, headOnly);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy listening on ${PORT}`);
});
