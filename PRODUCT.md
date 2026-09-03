# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro static frontend on Firebase Hosting at `uzenofuzet.web.app`, with the existing TypeScript/Express MCP backend deployed to Google Cloud Run and reached through Firebase Hosting rewrites.

## Users

- Primary user (inferred from the KRÉTA workflow): a Hungarian parent who wants to ask Claude about one or more children's KRÉTA data from web or mobile.
- Operator: PROGOS, deploying and monitoring the shared hosted service.

## Product Purpose

Üzenőfüzet makes selected, read-only KRÉTA student data available to Claude through a custom MCP connector. Success means a parent can understand the trust boundary, connect the service without copying tokens, and verify that the service is available.

## Positioning

The hosted service discards the KRÉTA password after login and keeps no per-user credential database. It seals the KRÉTA refresh token into the credential held by Claude. This is storage-free, not zero-knowledge: the password passes through the service during login and the operator owns the sealing key.

## Operating Context

Parents discover the service on the landing page, add `https://uzenofuzet.web.app/mcp` as a Claude custom connector, and complete the KRÉTA login inside the OAuth flow. The dashboard is a connection/setup and service-status surface; the current architecture cannot inspect a user's Claude-side connector state.

## Capabilities and Constraints

- The MCP tool set is fixed and read-only.
- The service supports up to three children in one connector session.
- The hosted service must not claim official affiliation with eKRÉTA Zrt.
- The KRÉTA student API is undocumented and may change without notice.
- The deploy currently needs one Cloud Run instance because refresh-token rotation and authorization-code replay protection are held in memory.
- KRÉTA credentials remain storage-free. Separately, the public advocacy wall uses Firebase Authentication and Firestore: one optional public message per verified Google account, keyed by Firebase user ID.
- A Google account does not have to be connected to a student. The dashboard is a setup/status surface, not a personalized student-data store.
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
