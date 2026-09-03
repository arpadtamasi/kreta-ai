# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro static frontend on Firebase Hosting at `uzenofuzet.tilosazai.org`, with the existing TypeScript/Express MCP backend deployed to Google Cloud Run and reached through Firebase Hosting rewrites.

## Users

- Primary user (inferred from the KRÉTA workflow): a Hungarian parent who wants to ask Claude about one or more children's KRÉTA data from web or mobile.
- Operator: PROGOS, deploying and monitoring the shared hosted service.

## Product Purpose

Üzenőfüzet makes selected, read-only KRÉTA student data available to Claude through a custom MCP connector. Success means a parent can understand the trust boundary, connect the service without copying tokens, and verify that the service is available.

## Positioning

The hosted service uses a verified Google account to store up to three child profiles: the child's real name, KRÉTA username, and institution code. It never stores the KRÉTA password. Connecting a child creates an encrypted KRÉTA token pair in that private profile. The parent may choose a 30-minute trial or explicitly opt into a 25-minute keep-alive loop, optionally with an end date. The password is transient, not zero-knowledge: it passes through the service during login and the operator owns the encryption key.

## Operating Context

Parents discover the service on the landing page, sign in with Google on the dashboard, add a child and make that profile Online with the KRÉTA password, then add `https://uzenofuzet.tilosazai.org/mcp` as a Claude custom connector. Claude's authorization is then an ordinary Google-backed OAuth step; its tokens contain profile references, not KRÉTA credentials. The dashboard is a profile/setup and service-status surface; the current architecture cannot inspect a user's Claude-side connector state.

## Capabilities and Constraints

- The MCP tool set is fixed and read-only.
- The service supports up to three children in one connector session.
- The hosted service must not claim official affiliation with eKRÉTA Zrt.
- The KRÉTA student API is undocumented and may change without notice.
- The deploy currently needs one Cloud Run instance because authorization-code replay protection is held in memory. Persisted connection refreshes use Firestore version checks.
- KRÉTA passwords are never stored. While a child is Online, Firestore stores the access and rotating refresh tokens as an expiring AES-256-GCM ciphertext under the verified parent's private profile. Offline removes the connection ciphertext but keeps the profile; deleting the profile removes both.
- An unchecked keep-alive choice creates a 30-minute trial. An opted-in connection is due for refresh every 25 minutes and can have an optional deadline.
- The dashboard can look up live institutions through eKRÉTA's public institution selector. Search terms pass through the server, results are bounded and short-lived, and manual institution-code entry remains available when the undocumented selector changes or fails.
- The public advocacy wall remains a separate opt-in record: one optional public message per verified Google account, keyed by Firebase user ID. A Google account can still use the wall without creating a child profile.
- Public launch requires a separate privacy/legal review because the service processes minors' educational data.

## Brand Commitments

- Product name: Üzenőfüzet.
- Language: plain, direct Hungarian; warnings must stay explicit and must not soften the credential-handling risk.
- The experience is for parents, not a child-facing school app.
- The “Hogyan működik?” page must say plainly that the password passes through the service because eKRÉTA offers no official third-party authorization route; it must distinguish Google Cloud infrastructure security from trust in the operator.
- Users who do not accept that trust boundary must be told not to use the hosted service and be offered the local version. The systemic closing message may encourage parents to request documented, secure access from their school and eKRÉTA, including collective advocacy, without claiming a specific legal entitlement.

## Evidence on Hand

- Hosted server implementation and tests under `server/`.
- Security and architecture explanation under `server/README.md`.
- The user supplied a real conversation only as behavioral reference. Public UI must replace all child, teacher, class and incident details with clearly labeled synthetic examples.
- No testimonials, usage metrics, institutional endorsements, or approved visual identity are available; future work must not fabricate them.

## Product Principles

- Explain the trust boundary before asking for credentials.
- Keep the parent in control of connection and removal.
- Prefer specific, verifiable statements over broad security claims.
- Keep the connector setup short enough to complete on a phone.
- Treat failure and service status as actionable information.

## Accessibility & Inclusion

The web UI must work with keyboard navigation, visible focus, reduced motion, strong contrast, and responsive layouts down to a 390 px mobile viewport.
