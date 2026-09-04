# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro static frontend on Firebase Hosting at `uzenofuzet.hu`, with the existing TypeScript/Express MCP backend deployed to Google Cloud Run and reached through Firebase Hosting rewrites.

## Users

- Primary user: a Hungarian parent who wants to ask Claude about one or more children's KRÉTA and Google Classroom data from web or mobile.
- Operator: PROGOS, deploying and monitoring the shared hosted service.

## Product Purpose

Üzenőfüzet makes selected, read-only KRÉTA and Google Classroom student data available to Claude through a custom MCP connector. Success means a parent can understand each trust boundary, connect every child to the right accounts without copying tokens, and verify that the service is available.

## Positioning

The hosted service uses a verified parent's Google account to store up to three child profiles: the child's real name, KRÉTA username, and institution code. It never stores the KRÉTA password. Connecting KRÉTA creates an encrypted token pair in that private profile. Separately, each child can authorize their own school Google account for read-only Classroom access; its refresh grant is encrypted in the same private profile. The parent may choose a 30-minute KRÉTA trial or explicitly opt into a 25-minute keep-alive loop, optionally with an end date. Neither storage path is zero-knowledge because the operator owns the encryption key.

## Operating Context

Parents discover the service on the landing page, sign in with their parent Google account on the dashboard, add a child, and connect either or both sources. KRÉTA uses the transient password flow; Classroom redirects to Google so that child can select their own school account. The parent then adds `https://uzenofuzet.hu/mcp` as a Claude custom connector. Claude's authorization uses the parent session and its tokens contain only profile references—not KRÉTA or Classroom credentials. The dashboard is a profile/setup and service-status surface; the current architecture cannot inspect a user's Claude-side connector state.

## Capabilities and Constraints

- The MCP tool set is fixed and read-only.
- Classroom exposes five fixed list tools for courses, coursework, the child's own submissions/grades, announcements, and course materials. It has no generic Google API proxy and no write operation.
- The service supports up to three children in one connector session.
- The hosted service must not claim official affiliation with eKRÉTA Zrt.
- The KRÉTA student API is undocumented and may change without notice.
- The deploy currently needs one Cloud Run instance because authorization-code replay protection is held in memory. Persisted connection refreshes use Firestore version checks.
- KRÉTA passwords are never stored. While a child is Online, Firestore stores the access and rotating refresh tokens as an expiring AES-256-GCM ciphertext under the verified parent's private profile. Offline removes the connection ciphertext but keeps the profile; deleting the profile removes both.
- An unchecked keep-alive choice creates a 30-minute trial. An opted-in connection is due for refresh every 25 minutes and can have an optional deadline.
- Every Classroom grant belongs to one child profile and may represent a different school Google account. The dashboard must keep the parent login and per-child Classroom consent visibly distinct.
- The dashboard can look up live institutions through eKRÉTA's public institution selector. Search terms pass through the server, results are bounded and short-lived, and manual institution-code entry remains available when the undocumented selector changes or fails.
- The public advocacy wall implementation is retained for possible later use, but it is not currently exposed in the public product UI. The landing has one conversion goal: connect Üzenőfüzet to Claude.
- Public launch requires a separate privacy/legal review because the service processes minors' educational data.

## Brand Commitments

- Product name: Üzenőfüzet.
- Language: plain, direct Hungarian; warnings must stay explicit and must not soften the credential-handling risk.
- The experience is for parents, not a child-facing school app.
- The “Hogyan működik?” page must say plainly that the password passes through the service because eKRÉTA offers no official third-party authorization route; it must distinguish Google Cloud infrastructure security from trust in the operator.
- Users who do not accept that trust boundary must be told not to use the hosted service. Public product pages should not advertise a separate desktop path or introduce an advocacy call to action unless that campaign is explicitly reactivated.

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
