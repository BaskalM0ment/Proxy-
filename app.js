const form = document.getElementById('proxyForm');
const input = document.getElementById('urlInput');
const viewer = document.getElementById('viewer');
const status = document.getElementById('status');
const blankButton = document.getElementById('blankButton');
const backButton = document.getElementById('backButton');
const forwardButton = document.getElementById('forwardButton');
const reloadButton = document.getElementById('reloadButton');

const historyStack = [];
let historyIndex = -1;

function normalizeUrl(value) {
  let valueToUse = value.trim();
  if (!valueToUse) throw new Error('Enter a URL.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(valueToUse)) valueToUse = 'https://' + valueToUse;
  const url = new URL(valueToUse);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  return url.href;
}

function proxyUrl(target) {
  return `/proxy?url=${encodeURIComponent(target)}`;
}

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function load(target, addHistory = true) {
  try {
    const url = normalizeUrl(target);
    input.value = url;
    viewer.src = proxyUrl(url);
    if (addHistory) {
      historyStack.splice(historyIndex + 1);
      historyStack.push(url);
      historyIndex = historyStack.length - 1;
    }
    setStatus(`Loading ${url}`, 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  load(input.value);
});

blankButton.addEventListener('click', () => {
  const url = input.value.trim();
  if (!url) return setStatus('Enter a URL first.', 'error');
  const normalized = (() => { try { return normalizeUrl(url); } catch (e) { setStatus(e.message, 'error'); return null; } })();
  if (!normalized) return;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Proxy</title></head><body style="margin:0"><iframe src="${proxyUrl(normalized).replaceAll('"','&quot;')}" style="width:100vw;height:100vh;border:0" allowfullscreen></iframe></body></html>`;
  const win = window.open('about:blank', '_blank');
  if (!win) return setStatus('The browser blocked the about:blank window. Allow pop-ups for this site.', 'error');
  win.document.open();
  win.document.write(html);
  win.document.close();
});

backButton.addEventListener('click', () => {
  if (historyIndex <= 0) return;
  historyIndex--;
  load(historyStack[historyIndex], false);
});

forwardButton.addEventListener('click', () => {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  load(historyStack[historyIndex], false);
});

reloadButton.addEventListener('click', () => {
  if (viewer.src) viewer.src = viewer.src;
});
