const form = document.getElementById('proxyForm');
const input = document.getElementById('urlInput');
const viewer = document.getElementById('viewer');
const status = document.getElementById('status');
const blankButton = document.getElementById('blankButton');
const backButton = document.getElementById('backButton');
const forwardButton = document.getElementById('forwardButton');
const reloadButton = document.getElementById('reloadButton');
const serviceState = document.getElementById('serviceState');

const historyStack = [];
let historyIndex = -1;

function normalizeUrl(value) {
  let candidate = value.trim();
  if (!candidate) throw new Error('Enter a URL.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  return url.href;
}

function proxyUrl(target) {
  return `/proxy?url=${encodeURIComponent(target)}`;
}

function setStatus(message, type = '') {
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function updateButtons() {
  backButton.disabled = historyIndex <= 0;
  forwardButton.disabled = historyIndex < 0 || historyIndex >= historyStack.length - 1;
  reloadButton.disabled = !viewer.src;
}

function load(target, addToHistory = true) {
  try {
    const url = normalizeUrl(target);
    input.value = url;
    viewer.src = proxyUrl(url);

    if (addToHistory) {
      historyStack.splice(historyIndex + 1);
      historyStack.push(url);
      historyIndex = historyStack.length - 1;
    }

    setStatus(`Loading ${url}`, 'ok');
    updateButtons();
  } catch (error) {
    setStatus(error.message || 'Invalid URL.', 'error');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  load(input.value);
});

blankButton.addEventListener('click', () => {
  try {
    const url = normalizeUrl(input.value);
    const popup = window.open('about:blank', '_blank');

    if (!popup) {
      setStatus('Allow pop-ups for this site to use about:blank.', 'error');
      return;
    }

    const frame = popup.document.createElement('iframe');
    popup.document.title = 'Web Viewer';
    popup.document.documentElement.style.cssText = 'width:100%;height:100%;margin:0;background:#000';
    popup.document.body.style.cssText = 'width:100%;height:100%;margin:0;overflow:hidden';
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
    frame.src = new URL(proxyUrl(url), location.href).href;
    frame.referrerPolicy = 'no-referrer';
    popup.document.body.appendChild(frame);

    setStatus('Opened in a new about:blank window.', 'ok');
  } catch (error) {
    setStatus(error.message || 'Could not open the URL.', 'error');
  }
});

backButton.addEventListener('click', () => {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  load(historyStack[historyIndex], false);
  updateButtons();
});

forwardButton.addEventListener('click', () => {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex += 1;
  load(historyStack[historyIndex], false);
  updateButtons();
});

reloadButton.addEventListener('click', () => {
  if (!viewer.src) return;
  const current = viewer.src;
  viewer.removeAttribute('src');
  requestAnimationFrame(() => { viewer.src = current; });
  setStatus('Reloading...', 'ok');
});

viewer.addEventListener('load', () => {
  if (!viewer.src) return;
  setStatus('Page loaded.', 'ok');
  updateButtons();
});

viewer.addEventListener('error', () => {
  setStatus('The page could not be loaded through the proxy.', 'error');
});

fetch('/health', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('Health check failed');
    serviceState.textContent = 'Ready';
    serviceState.classList.remove('offline');
  })
  .catch(() => {
    serviceState.textContent = 'Offline';
    serviceState.classList.add('offline');
    setStatus('The local proxy service is unavailable.', 'error');
  });

updateButtons();
