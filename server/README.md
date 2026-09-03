# Üzenőfüzet — hosztolt KRÉTA MCP-szerver

Custom Connector Claude-hoz, ami a KRÉTA tanulói adatokat **csak olvasásra**
teszi elérhetővé. Google-fiókonként legfeljebb három privát gyerekprofilt
tárol (rendes név, KRÉTA-felhasználónév, intézménykód), de **KRÉTA-jelszót
és felhasználónkénti tokent nem tárol**.

A landing oldalon ettől elkülönül egy nyilvános üzenőfal. Az opcionális
kiálláshoz a Firebase Authentication hitelesíti a Google-fiókot, a Firestore
pedig a nyilvános nevet és üzenetet tárolja. A falhoz nem kell gyerekprofilt
létrehozni, és az e-mail-cím nem jelenik meg az üzenőfalon.

Ez a repó helyben futó változatának (`python/`, `desktop/`) a párja. Az a
kettő a szülő gépén fut; ez egy szerver, ami cserébe **claude.ai weben és
mobilon is működik**, ahol a helyi MCP-szerverek nem.

> Független projekt. Nem áll kapcsolatban az eKRÉTA Zrt.-vel, és nem hivatalos
> KRÉTA-termék. A KRÉTA tanulói API nem nyilvános integrációs API; a belépés
> vagy a végpontok bejelentés nélkül megváltozhatnak.

## Hogyan lehet jelszó nélkül

A ghub-ai (a testvérprojekt) esetében a Google igazi OAuth-partner: a jelszó a
`accounts.google.com`-on születik, a szerver csak refresh tokent lát. A KRÉTA
nem ilyen — nincs harmadik feles kliensregisztráció, a `client_id` és a
`redirect_uri` a hivatalos mobilappé, és nem cserélhető le. Federálni tehát
nincs mihez.

Ezért itt **a `/authorize` oldal maga a KRÉTA-login**:

1. A szülő Google-belépés után egyszer elmenti a gyerek rendes nevét,
   KRÉTA-felhasználónevét és intézménykódját a kapcsolati pulton.
2. Claude megnyitja a `/authorize`-t a szülő böngészőjében. A szerver a
   Google-munkamenet alapján betölti a mentett profilokat.
3. A szülő gyerekenként csak a rendes nevet és a KRÉTA-jelszót adja meg.
   A mezők szabványos `username` / `current-password` automatikuskitöltést
   használnak, így a jelszókezelő párként tudja megjegyezni őket.
4. A szerver ott helyben bejelentkezik a KRÉTA IDP-be, megkapja a
   token-párt, és **a jelszót eldobja**. Nem írja ki sehova, nem naplózza,
   és nem teszi bele semmilyen tokenbe.
5. A KRÉTA refresh token AES-256-GCM-mel **lezárva belekerül abba a
   tokenbe, amit Claude kap**. Claude tárolja; ez a szerver nem.

Egy rövid, ismerős név–jelszó űrlap, nulla azonosító-copy-paste — és a
szerveren nincs se jelszó-, se tokenadatbázis.

## Mit jelent pontosan a „nem tárol"

**Amit nyersz.** Nyugalmi állapotban nincs KRÉTA-jelszó és nincs
felhasználónkénti KRÉTA-token. A Firestore-ban csak a Google-fiókhoz kötött
név, felhasználónév és intézménykód van; ezek a kapcsolati pulton törölhetők.
A szerver nem tud új belépést kezdeményezni, mert nincs nála jelszó.

**Amit nem nyersz.** A jelszó a te szervered memóriáján megy át a
bejelentkezéskor, és a lezáró kulcs a tiéd — tehát a Claude által
bemutatott tokent ki tudod bontani. Ez „nincs hitelesítőadat-tár", nem
„zero knowledge". Továbbá a lezárt refresh token gyakorlatilag ugyanolyan
erős, mint a jelszó: a KRÉTA-scope az e-ügyintézést és a fájlszolgáltatást
is tartalmazza, még ha ez a szerver csak `GET`-eket hív is.

**És alakilag phishing.** A szülő egy nem-KRÉTA domainre gépeli be az
iskolai jelszavát. A bejelentkező oldal ezt ki is írja, keretes
figyelmeztetésben, a mezők fölött. Ezt a szöveget ne lágyítsd.

## Rotál-e a refresh token? — ez dönti el, működik-e tárolás nélkül

A lezárt access token a bejelentkezéskor kapott refresh tokent viszi. Ha a
KRÉTA IDP **rotál** (minden frissítésnél újat ad és a régit érvényteleníti),
akkor az a lezárt példány az első használat után elavul — és egy tárolás
nélküli szervernek nincs hova felírnia az újat.

Erre két válasz van a kódban:

- `src/kreta/rotationCache.ts` — memóriában tartja a legfrissebb refresh
  tokent, a session id alapján. Egy példányos deploynál
  (`--max-instances=1`) ez a kapcsolat teljes élettartamát lefedi, kivéve
  egy hidegindítást; utána visszaesik a lezárt eredetire.
- `kreta_login` tool — a válaszában ott van a
  `refresh_token_rotation_observed` mező. **Ez a mérés.** Hívd meg,
  használd a connectort egy napig, hívd meg újra.

**Ha `true`-t látsz és a kapcsolat rendszeresen elhal**, akkor a tárolás
nélküli út nem tartható: a `RotationCache` interfésze pontosan az a varrat,
ahova egy tartós tár (Firestore + Secret Manager, ahogy a ghub-ai csinálja)
bekerül. Akkor is **a refresh tokent tárold, ne a jelszót** — a UX
ugyanez az egy űrlap marad.

## Deploy

```bash
cd server
npm install
npm run keygen            # ezt tedd Secret Managerbe TOKEN_SEALING_KEY néven
npm test
npm run build
```

Cloud Runra:

```bash
gcloud run deploy uzenofuzet \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --max-instances=1 \
  --set-env-vars OAUTH_ISSUER=https://<a-te-domained> \
  --set-secrets TOKEN_SEALING_KEY=uzenofuzet-sealing-key:latest
```

A `--max-instances=1` **nem véletlen**: két folyamat közül csak az egyik
ismeri a rotációs cache-t és a beváltott kódokat (lásd
`src/oauth/replayCache.ts`). Egyetlen példány mellett mindkét garancia teljes.

Ezután Claude-ban: Settings → Connectors → Add custom connector → a
szolgáltatás URL-je. Claude felfedezi a `/.well-known/...` végpontokat, maga
regisztrál, és megnyitja a bejelentkező oldalt.

### Firebase Hosting, Google-belépés, gyerekprofilok és üzenőfal

Az Astro frontend statikusan a `public/` könyvtárba épül. A Firebase Hosting
csak az API-, MCP- és OAuth-útvonalakat továbbítja a fenti Cloud Run
szolgáltatáshoz; a többi útvonalat és a 404 oldalt statikusan szolgálja ki.

```bash
cd server
npm run build:web
firebase deploy --project uzenofuzet --only firestore:rules,hosting
```

A Google-belépéshez a Firebase Console Authentication → Sign-in method
oldalán engedélyezni kell a Google szolgáltatót és megadni a projekt
támogatási e-mail-címét. A kliens csak a Firebase publikus webkonfigurációját
kapja; az ID tokent és az OAuth-hoz használt, `HttpOnly` `__session` sütit a
backend Firebase Adminnal ellenőrzi. A Firestore kliensszabályok mindent
tiltanak: a gyerekprofilokat és az üzenőfalat csak a Cloud Run szolgáltatás
olvassa és írja.

Az intézmény mező három karakter után a nyilvános eKRÉTA intézménykeresőt
hívja a Cloud Run szerveren keresztül. A backend a kapott HTML-listából csak
az intézmény nevét és kódját adja tovább, legfeljebb húsz találattal. A kereső
kényelmi funkció: ha a nem dokumentált külső végpont nem elérhető, a kód kézzel
is megadható.

## Helyi próba

```bash
cd server
TOKEN_SEALING_KEY="$(npm run --silent keygen)" \
OAUTH_ALLOWED_REDIRECT_URIS="http://localhost:6274/oauth/callback" \
npm run dev
```

Az `OAUTH_ALLOWED_REDIRECT_URIS` az a lista, amiből a kliens választhat
redirect URI-t; alapból csak Claude két connector-callbackje szerepel benne.

## Felépítés

| Fájl | Szerep |
|---|---|
| `src/seal.ts` | AES-256-GCM lezárt tokenek — ez teszi lehetővé a tárolás nélküli működést |
| `src/oauth/router.ts` | OAuth 2.1 AS, aminek a `/authorize`-a a KRÉTA-login |
| `src/oauth/pages.ts` | a bejelentkező űrlap (és a figyelmeztetés) |
| `src/oauth/clients.ts` | állapotmentes kliensregisztráció: a `client_id` maga a rekord |
| `src/oauth/replayCache.ts` | egyszer-használatos authorization code, példányon belül |
| `src/kreta/auth.ts` | KRÉTA belépés / frissítés / visszavonás — az egyetlen hely, ahol jelszó van |
| `src/kreta/client.ts` | csak olvasó Student API kliens |
| `src/kreta/rotationCache.ts` | a rotáció elleni memóriabeli védőháló |
| `src/mcp/server.ts` | a 20 csak-olvasó tool |
| `src/pledges/router.ts` | hitelesített nyilvános üzenetek API-ja |
| `src/pledges/store.ts` | az üzenőfal Firestore-adattára |
| `src/profiles/router.ts` | a Google-fiókhoz kötött gyerekprofilok API-ja |
| `src/profiles/store.ts` | a privát gyerekprofilok Firestore-adattára |
| `src/auth/router.ts` | rövid Google ID tokenből `HttpOnly` OAuth-munkamenet |
| `src/institutes/` | hitelesített adapter az eKRÉTA intézménykereső HTML-válaszához |
| `web/` | Astro landing, dashboard és tájékoztató oldalak |

## Amit ez a szerver nem csinál

Nincs írás, nincs törlés, nincs tetszőleges API-útvonal, és nincs
csatolmány-letöltés. Ezt a rögzített toollista tartja, nem egy jogosultsági
beállítás — a KRÉTA-scope ennél többet engedne.

## Nyitott kérdések, mielőtt bárki másnak odaadod

- **Rotáció** — lásd fent; ez az első mérés.
- **IP-tiltás.** Egy Cloud Run IP-ről sok iskola IDP-jébe belépni pont úgy
  néz ki, mint a credential stuffing.
- **Adatvédelem.** Ha nem csak a saját gyerekeid adatait szolgálod ki,
  kiskorúak oktatási adatai felett adatkezelővé válsz, egy nem dokumentált,
  nem engedélyezett API-n. A helyben futó változat README-je ma kifejezetten
  azt ígéri, hogy nincs hosztolt szolgáltatás — ezt együtt kell frissíteni
  azzal, hogy ez élesbe megy.
