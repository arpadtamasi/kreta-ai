# Üzenőfüzet — hosztolt KRÉTA MCP-szerver

Custom Connector Claude-hoz, ami a KRÉTA tanulói adatokat **csak olvasásra**
teszi elérhetővé. Google-fiókonként legfeljebb három privát gyerekprofilt
tárol (rendes név, KRÉTA-felhasználónév, intézménykód). A **KRÉTA-jelszót
nem tárolja**. Amíg egy gyerek Online, az access és refresh token lejáró,
AES-256-GCM-mel titkosított formában a privát profilban van.

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

## Miért ilyen a kapcsolat

A ghub-ai (a testvérprojekt) esetében a Google igazi OAuth-partner: a jelszó a
`accounts.google.com`-on születik, a szerver csak refresh tokent lát. A KRÉTA
nem ilyen — nincs harmadik feles kliensregisztráció, a `client_id` és a
`redirect_uri` a hivatalos mobilappé, és nem cserélhető le. Federálni tehát
nincs mihez.

Az access token 30 percig él. Minden frissítés új access és új, egyszer
használható refresh tokent ad; a korábbi refresh token utána már nem
használható. Ezért két üzemmód van:

- **30 perces próba:** nincs háttérfrissítés, lejáratkor a titkosított
  kapcsolat is törlődik.
- **Online tartás:** a szülő kifejezett jelölésére a szerver 25 percenként
  frissít, és az új tokenpárt verzióellenőrzéssel visszaírja. Opcionális
  végdátum adható.

A felhasználói út:

1. A szülő Google-belépés után egyszer elmenti a gyerek rendes nevét,
   KRÉTA-felhasználónevét és intézménykódját, majd megadja a jelszót.
2. A szerver ott helyben bejelentkezik a KRÉTA IDP-be, megkapja a
   token-párt, és **a jelszót eldobja**. Nem írja ki sehova, nem naplózza,
   és nem teszi bele semmilyen tokenbe.
3. A szerver a kiválasztott időtartamra titkosítva elmenti a tokenpárt a
   szülő Firestore-profiljába.
4. Claude megnyitja a `/authorize`-t. Az Üzenőfüzet Google-munkamenettel
   azonosítja a szülőt, és a Claude-nak adott OAuth-tokenbe csak az Online
   gyerekprofilok hivatkozásai kerülnek.
5. Az Online állapot bármikor kikapcsolható. Ez visszavonja és törli a
   KRÉTA-kapcsolatot, de a gyerekprofil megmarad.

Így a KRÉTA sajátossága a kapcsolati pulton marad; Claude-ban a belépés
szokványos Google-alapú OAuth-folyamat.

## Mit jelent pontosan a titkosított tárolás

**Amit nyersz.** A KRÉTA-jelszó nyugalmi állapotban nincs sehol, és a szerver
nem tud új teljes belépést kezdeményezni. A tokenek AES-256-GCM ciphertextként,
kemény lejárattal kerülnek Firestore-ba. A próbát 30 perc után a háttérmunka
eltávolítja; az Online kapcsolás és a teljes profil is törölhető a pulton.

**Amit nem nyersz.** A jelszó a te szervered memóriáján megy át a
bejelentkezéskor, és a lezáró kulcs a tiéd — tehát a profilban lévő tokent
ki tudod bontani. Ez nyugalmi titkosítás, nem „zero knowledge". Továbbá a
lezárt refresh token gyakorlatilag ugyanolyan
erős, mint a jelszó: a KRÉTA-scope az e-ügyintézést és a fájlszolgáltatást
is tartalmazza, még ha ez a szerver csak `GET`-eket hív is.

**És alakilag phishing.** A szülő egy nem-KRÉTA domainre gépeli be az
iskolai jelszavát. A kapcsolati pult ezt a mező előtt egyértelműen kiírja.
Ezt a szöveget ne lágyítsd.

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
  --set-env-vars OAUTH_ISSUER=https://<a-te-domained>,REFRESH_JOB_AUDIENCE=https://<run-url>,REFRESH_JOB_SERVICE_ACCOUNT=uzenofuzet-refresher@<project>.iam.gserviceaccount.com \
  --set-secrets TOKEN_SEALING_KEY=uzenofuzet-sealing-key:latest
```

A `--max-instances=1` az authorization code memóriabeli replay-védelme miatt
marad. A KRÉTA-tokenek rotációját a Firestore verzióellenőrzése védi.

Az Online kapcsolatokhoz hozz létre egy külön, belépési jog nélküli service
accountot és egy ötpercenként futó Cloud Scheduler HTTP jobot. A job a közvetlen
Cloud Run URL `POST /internal/refresh-connections` végpontját hívja OIDC ID
tokennel; az audience a `run.app` origin, az e-mail a fenti két env változóval
egyezzen. A végpont csak az éppen esedékes kapcsolatokat frissíti, alapból
legfeljebb negyvenet futásonként.

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
tiltanak: a gyerekprofilokat, a titkosított kapcsolatokat és az üzenőfalat
csak a Cloud Run szolgáltatás olvassa és írja.

Az intézmény mező három karakter után a nyilvános eKRÉTA intézménykeresőt
hívja a Cloud Run szerveren keresztül. A backend a kapott HTML-listából csak
az intézmény nevét és kódját adja tovább, legfeljebb húsz találattal. A kereső
kényelmi funkció: ha a nem dokumentált külső végpont nem elérhető, a kód kézzel
is megadható.

### KRÉTA relay adatközponti hálózatokhoz

A KRÉTA a központi belépési és intézményi végpontjain TCP-szinten eldobja az
ismert adatközponti kimeneteket, köztük a Google Cloud, AWS, Hetzner és ATW
címeit. A szerver ezért opcionálisan egy saját magyar lakossági hálózaton futó
relayt használ. A Cloud Run és a relay között a teljes kérés AES-256-GCM-mel
titkosított; a relay kizárólag HTTPS `*.e-kreta.hu` és `*.ekreta.hu` célokat
enged át, és nem naplózza a kéréstörzset.

Helyi indítás a szerver buildje után:

```bash
KRETA_RELAY_KEY="<32 bájtos base64url kulcs>" node dist/relay.js
```

A helyi `127.0.0.1:39090` portot hitelesített HTTPS tunnel mögé kell tenni,
majd a Cloud Run szolgáltatásnak együtt kell megadni:

```text
KRETA_RELAY_URL=https://<saját-tunnel>/v1/fetch
KRETA_RELAY_KEY=<ugyanaz a kulcs>
```

A relayt futtató gépnek online kell maradnia. A relay `/health` végpontja nem
ér el KRÉTA-adatot; csak a helyi folyamat életét jelzi.

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
| `src/seal.ts` | AES-256-GCM lezárt OAuth-értékek és profilkapcsolati hitelesítő adatok |
| `src/oauth/router.ts` | Google-munkamenetre és Online profilokra épülő OAuth 2.1 AS |
| `src/oauth/pages.ts` | terminális OAuth-hibaoldal |
| `src/oauth/clients.ts` | állapotmentes kliensregisztráció: a `client_id` maga a rekord |
| `src/oauth/replayCache.ts` | egyszer-használatos authorization code, példányon belül |
| `src/kreta/auth.ts` | KRÉTA belépés / frissítés / visszavonás — az egyetlen hely, ahol jelszó van |
| `src/kreta/client.ts` | csak olvasó Student API kliens |
| `src/kreta/relay.ts` | eKRÉTA-hostokra korlátozott, titkosított relay transzport |
| `src/relay.ts` | magyar lakossági hálózaton futó helyi relay folyamat |
| `src/mcp/server.ts` | a 20 csak-olvasó tool |
| `src/pledges/router.ts` | hitelesített nyilvános üzenetek API-ja |
| `src/pledges/store.ts` | az üzenőfal Firestore-adattára |
| `src/profiles/router.ts` | a Google-fiókhoz kötött gyerekprofilok API-ja |
| `src/profiles/store.ts` | a privát profilok, titkosított kapcsolatok és frissítési sor Firestore-adattára |
| `src/profiles/refresher.ts` | 25 perces tokenrotáció, határidő és 30 perces próbatakarítás |
| `src/auth/router.ts` | rövid Google ID tokenből `HttpOnly` OAuth-munkamenet |
| `src/institutes/` | hitelesített adapter az eKRÉTA intézménykereső HTML-válaszához |
| `web/` | Astro landing, dashboard és tájékoztató oldalak |

## Amit ez a szerver nem csinál

Nincs írás, nincs törlés, nincs tetszőleges API-útvonal, és nincs
csatolmány-letöltés. Ezt a rögzített toollista tartja, nem egy jogosultsági
beállítás — a KRÉTA-scope ennél többet engedne.

## Nyitott kérdések, mielőtt bárki másnak odaadod

- **IP-tiltás.** Egy Cloud Run IP-ről sok iskola IDP-jébe belépni pont úgy
  néz ki, mint a credential stuffing.
- **Adatvédelem.** Ha nem csak a saját gyerekeid adatait szolgálod ki,
  kiskorúak oktatási adatai felett adatkezelővé válsz, egy nem dokumentált,
  nem engedélyezett API-n. A helyben futó változat README-je ma kifejezetten
  azt ígéri, hogy nincs hosztolt szolgáltatás — ezt együtt kell frissíteni
  azzal, hogy ez élesbe megy.
