# Security Policy

## Supported Versions

Only the latest release of Delamain is actively supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| v1.0.x  | :white_check_mark: |
| < v1.0  | :x:                |

## Reporting a Vulnerability

**Do not open a GitHub Issue for security vulnerabilities.**

If you discover a potential security risk, please report it privately by emailing **necropsyk@gmail.com**.

Please include:
- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact if exploited

I will acknowledge your report within 48 hours and provide a timeline for a fix.

## Security Model

Delamain is designed for personal or trusted-network use. Keep the following in mind:

- **JWT authentication** is enforced on all API endpoints and WebSocket connections. Tokens expire after 30 days.
- **Rate limiting** is applied to the login endpoint (10 requests/minute per IP) to prevent brute-force attacks.
- **The sunnypilot bridge** (`client_id = "sunnypilot-bridge"`) is exempt from token auth and is assumed to be on a trusted LAN. Do not expose port 8888 directly to the internet without a reverse proxy and TLS.
- **HTTPS / TLS** is not handled by Delamain itself — use a reverse proxy (nginx, Caddy, Cloudflare Tunnel) if you need remote access.

Always run Delamain behind a VPN or secure tunnel if exposing it beyond your local network.
