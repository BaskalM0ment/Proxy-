# Proxy

A simple proxy frontend with a Netlify Function backend.

## Deploy

1. Import this GitHub repository into Netlify.
2. Use the repository root as the project directory.
3. Deploy with the included `netlify.toml`.
4. Open the deployed site and enter an HTTP or HTTPS URL.

## About:blank

Click **Open in about:blank** to create a new `about:blank` window containing the proxied viewer.

Popup blocking can prevent the new window from opening. Allow pop-ups for the deployed site if necessary.

## Limitations

This is a basic HTTP fetch proxy. Some modern sites will not work correctly because they depend on JavaScript APIs, authentication, WebSockets, absolute asset URLs, anti-bot systems, or browser security policies. A production proxy needs more complete response rewriting and stronger abuse protection.
