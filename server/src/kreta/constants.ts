/**
 * KRÉTA IDP and mobile-API constants used by the hosted integration to speak
 * to the fixed endpoints with the official mobile client's identity.
 *
 * The client id and redirect URI belong to the official student mobile app.
 * They are not ours and cannot be replaced: KRÉTA has no third-party client
 * registration, which is the whole reason /authorize has to host the login
 * form itself (see src/oauth/router.ts).
 */
export const IDP_BASE_URL = "https://idp.e-kreta.hu";
export const AUTHORIZE_URL = `${IDP_BASE_URL}/connect/authorize`;
export const TOKEN_URL = `${IDP_BASE_URL}/connect/token`;
export const REVOCATION_URL = `${IDP_BASE_URL}/connect/revocation`;
export const REDIRECT_URI = "https://mobil.e-kreta.hu/ellenorzo-student/prod/oauthredirect";
export const CLIENT_ID = "kreta-ellenorzo-student-mobile-ios";

export const SCOPE = [
  "openid",
  "email",
  "offline_access",
  "kreta-ellenorzo-webapi.public",
  "kreta-eugyintezes-webapi.public",
  "kreta-fileservice-webapi.public",
  "kreta-mobile-global-webapi.public",
  "kreta-dkt-webapi.public",
  "kreta-ier-webapi.public",
].join(" ");

export const WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const MOBILE_USER_AGENT = "hu.ekreta.tanulo/1.0.5/Android/0/0";
export const MOBILE_API_KEY = "21ff6c25-d1da-4a68-a811-c881a6057463";

export const HTTP_TIMEOUT_MS = 25_000;
