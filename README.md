# Üzenőfüzet

Az Üzenőfüzet egy hosztolt, csak olvasható KRÉTA- és Google
Classroom-integráció Claude-hoz. A szülő a webes kapcsolati pulton legfeljebb
három gyerekprofilt kezelhet; minden gyerekhez külön KRÉTA- és külön iskolai
Google-fiók kapcsolható.

Az aktív termékvonal kizárólag:

- **Firebase Hosting**: landing oldal, tájékoztatók és szülői dashboard;
- **Cloud Run**: belépés, OAuth, MCP, KRÉTA- és Classroom API-kapcsolatok;
- **Firestore**: privát gyerekprofilok és időkorlátos, titkosított kapcsolatok.

Nincs desktop bővítmény, helyi Python MCP-szerver vagy letölthető plugin.
Claude weben és mobilon Custom Connectoron keresztül kapcsolódik a hosztolt
szolgáltatáshoz.

## Adatkezelési alapelvek

- A szolgáltatás kizárólag rögzített olvasási műveleteket kínál.
- A KRÉTA-jelszó csak a belépés idejére kerül a Cloud Run folyamat memóriájába,
  majd azonnal eldobásra kerül.
- A lejáró KRÉTA-tokenek és Classroom refresh tokenek AES-256-GCM-mel lezárva
  kerülnek a privát Firestore-profilba.
- A szülő Google-belépése és a gyerekek Classroom-fiókjai külön
  Google-munkamenetek.
- A kapcsolat bármikor kikapcsolható és törölhető a dashboardon.

Az Üzenőfüzet független projekt, nem áll kapcsolatban az eKRÉTA Zrt.-vel, és
nem hivatalos KRÉTA-termék. A részletes adatkezelési tájékoztató és
felhasználási feltételek a publikus weboldalon érhetők el.

## Fejlesztés

A teljes alkalmazás a [`server/`](server/) könyvtárban található.

```bash
cd server
npm install
npm test
npm run typecheck
npm run build
```

A backend helyi indítása:

```bash
cd server
TOKEN_SEALING_KEY="$(npm run --silent keygen)" \
OAUTH_ALLOWED_REDIRECT_URIS="http://localhost:6274/oauth/callback" \
npm run dev
```

A szükséges környezeti változókat és az infrastruktúra részleteit a
[`server/README.md`](server/README.md) dokumentálja.

## Deploy

Firebase Hosting és Firestore-szabályok:

```bash
cd server
npm run build:web
firebase deploy --project uzenofuzet --only firestore:rules,hosting
```

A backend Cloud Runra kerül. A production parancsot, a Secret Manager
hivatkozásokat, a Classroom OAuth-beállításokat és a scheduler konfigurációját
lásd a [`server/README.md`](server/README.md) Deploy szakaszában.

## Licenc

[Apache License 2.0](LICENSE). A szoftver „AS IS” állapotban használható; a
KRÉTA rendszeréhez, nevéhez és védjegyéhez nem biztosít jogot.
