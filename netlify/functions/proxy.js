const http = require('node:http');
const https = require('node:https');

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;

function fetchUrl(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('Too many redirects.'));

    let url;
    try { url = new URL(target); } catch { return reject(new Error('Invalid URL.')); }
    if (!['http:', 'https:'].includes(url.protocol)) return reject(new Error('Only HTTP and HTTPS are supported.'));

    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 Proxy/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity'
      }
    }, response => {
      const location = response.headers.location;
      if (location && [301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        return fetchUrl(new URL(location, url).href, redirects + 1).then(resolve).catch(reject);
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode || 200,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });

    request.on('timeout', () => request.destroy(new Error('Upstream request timed out.')));
    request.on('error', reject);
  });
}

exports.handler = async event => {
  const target = event.queryStringParameters?.url;
  if (!target) return { statusCode: 400, headers: {'Content-Type':'text/plain'}, body: 'Missing url parameter.' };

  try {
    const result = await fetchUrl(target);
    const contentType = result.headers['content-type'] || 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    };

    // Browsers should not be allowed to frame a page using its original framing policy.
    // This proxy intentionally removes upstream CSP/X-Frame-Options headers.
    return {
      statusCode: result.statusCode,
      headers,
      body: result.body.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {'Content-Type':'text/plain','Access-Control-Allow-Origin':'*'},
      body: `Proxy error: ${error.message}`
    };
  }
};
