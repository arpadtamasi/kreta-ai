# Adatvédelmi audit — feladatlista

Kódalapú átvizsgálás a `server/` fán (`src`, `web`, rules- és configfájlok) és a
teljes git-historyn. Minden tétel fájlra és sorra hivatkozik; a sorszámok az
audit időpontjában érvényes `main`-hez képest értendők.

Az audit **feltárás volt, nem javítás** — ez a lista a nyitott munka. A tételek
prioritás szerint csoportosítva, a becslés a kockázatra vonatkozik, nem a
ráfordításra.

## Amit az audit tisztának talált

Ezeket nem kell újra végigfésülni, csak akkor, ha a mögöttes kód változik:

- **Logolás.** A teljes forrásban három kiírás van, egyik sem érint személyes
  adatot: `server/src/index.ts:14` (indulási konfighiba, statikus szöveg),
  `server/src/index.ts:21` (port + issuer), `server/src/relay.ts:140` (port).
  Nincs `console.log`, logger-könyvtár, Sentry vagy analytics sehol. A KRÉTA- és
  Classroom-válaszokat semmi nem naplózza; a hibaüzenetek fix magyar szövegek
  vagy csak HTTP-státuszt tartalmaznak (`server/src/kreta/client.ts:398`,
  `server/src/classroom/client.ts:19-23`), és a tool-wrapper kifejezetten eldobja
  az ismeretlen hibák üzenetét (`server/src/mcp/server.ts:67-75`, `:96-101`).
  Egyetlen kivétel a listán szereplő F3.
- **Firestore security rules.** `server/firestore.rules:7-9` mindent tilt, és ez
  helyes: a böngésző soha nem ír közvetlenül, a Firebase SDK-ból csak
  `firebase/auth` van importálva (`server/web/src/scripts/dashboard/firebase.ts:3`).
- **MCP tenant-izoláció.** Minden adatelérés `session.uid` + `profileId` párral
  megy, és a Firestore-út maga tartalmazza az uid-ot
  (`server/src/profiles/store.ts:226`). Mind az öt hívási hely ellenőrizve:
  `server/src/mcp/context.ts:57`, `:90`, `:112`, `:119`, és a `resolveChild`
  (`server/src/mcp/context.ts:22-39`) csak a tokenben lévő listából választhat.
  Nincs olyan út, ahol profileId uid nélkül fordulna elő — egy hitelesített
  felhasználó nem fér más felhasználó adatához.
- **Titkok a repóban és a historyban.** Az összes commiton átfésülve nincs
  `.env`, service account JSON, privát kulcs, `GOCSPX-` kliens-secret vagy
  beégetett `TOKEN_SEALING_KEY` / `KRETA_RELAY_KEY`. A `.gitignore:1-3` és
  `server/.gitignore:3-5` helyesen zár. A repóban lévő Firebase web `apiKey`
  (`server/web/src/scripts/dashboard/firebase.ts:6`), Google OAuth `client_id`
  (`server/web/src/pages/iskolai-admin.astro:4`) és KRÉTA `MOBILE_API_KEY`
  (`server/src/kreta/constants.ts:32`) szándékoltan publikus azonosítók.
- **Classroom-cache.** Nincs. A `ClassroomClient`
  (`server/src/classroom/client.ts:8`) kérésenként épül, semmit nem ír ki —
  törlési kérésnél nincs mit takarítani.

---

## Kritikus

- [ ] **K1 — A KRÉTA-relay a jelszót és minden tanulói választ egy repón kívüli
      gépre viszi, ami mindent vissza tud fejteni.**
      `server/src/index.ts:11` → `server/src/kreta/relay.ts:195-203` felülírja a
      globális `fetch`-et; `server/src/kreta/relay.ts:158-193` minden
      `*.e-kreta.hu` kérést becsomagol és a `KRETA_RELAY_URL`-re küld. A relay
      ugyanazzal a kulccsal bontja ki (`server/src/relay.ts:121`), majd
      cleartextben teszi meg az upstream kérést (`server/src/relay.ts:75-81`), az
      `authorization` és `cookie` fejléceket is átadva
      (`server/src/relay.ts:40-53`). Ezen a csövön megy át a KRÉTA-jelszó is
      (`server/src/kreta/auth.ts:151`), a friss tokenpár és minden jegy,
      hiányzás, feljegyzés.
      **Kockázat:** kiskorúak teljes iskolai adatát és a KRÉTA-jelszót olyan
      rendszerelem kezeli, ami sem a `server/.env.example`-ben, sem az
      adatkezelési tájékoztatóban (`server/web/src/pages/adatkezeles.astro`) nem
      szerepel — az érintettek nem tudnak róla, adatfeldolgozói szerződés sincs
      mögötte.

- [ ] **K2 — Kiadott MCP-tokent nem lehet visszavonni; 30 napig él, és
      „feltámad".**
      `server/src/config.ts:74-77` (30 nap), `server/src/oauth/router.ts:368`. A
      token maga a session, nincs mögötte tábla
      (`server/src/oauth/middleware.ts:1-5`); nincs `/revoke`, nincs
      introspekció, és a `sid` mező (`server/src/oauth/types.ts:16`) sehol nincs
      ellenőrizve. Kikapcsolt kapcsolat után a token érvényes marad, csak nem
      talál adatot — de ha a szülő ugyanazt a profilt újra összekapcsolja
      (`server/src/profiles/router.ts:178`, változatlan `id`), a régi token újra
      hozzáfér.
      **Kockázat:** egy kiszivárgott connector-token 30 napig letilthatatlan
      olvasási jog egy kiskorú összes iskolai adatához; az egyetlen ellenszer a
      `TOKEN_SEALING_KEY` rotálása, ami minden szülőt kidob
      (`server/src/config.ts:56`).

- [ ] **K3 — Egyetlen kulcs véd mindent, nincs KMS envelope encryption, és a
      lejárat nem kriptográfiai.**
      `server/src/config.ts:72` egyetlen `Sealer`-t hoz létre, ami minden célt
      pecsétel: OAuth code, access token, kliens-ID, consent-kérés,
      KRÉTA-hitelesítő, Classroom-state, Classroom-hitelesítő
      (`server/src/seal.ts:24-31`), sőt a kliens-secret is ennek HMAC-ja
      (`server/src/seal.ts:138`). Nincs Cloud KMS, nincs DEK/KEK szétválasztás,
      nincs kulcsverzió a borítékban (`server/src/seal.ts:20`), nincs rotációs
      út. A „kemény lejárat" csak alkalmazásszintű mezőellenőrzés
      (`server/src/seal.ts:126`), nem a titkosítás része.
      **Kockázat:** aki a kulcshoz fér (a szolgáltatás, bárki Secret Manager
      `secretAccessor` joggal, bárki a konténerben), az összes gyerek összes
      KRÉTA- és Classroom-hozzáférését kibontja — a lejárt borítékokat is,
      visszamenőleg.

- [ ] **K4 — A kiskorúak azonosító adatai titkosítás nélkül állnak a
      Firestore-ban.**
      `server/src/profiles/store.ts:290-299`: `childName`, `normalizedName`,
      `kretaUsername`, `instituteCode` sima mezők;
      `server/src/profiles/store.ts:195`: `classroomConnection.email` szintén. Az
      alkalmazásszintű boríték kizárólag a tokenekre terjed ki
      (`server/src/profiles/store.ts:8`, `:23`).
      **Kockázat:** a gyerek valódi neve, oktatási azonosítója, iskolája és
      iskolai e-mail-címe csak a Google alapértelmezett at-rest titkosítására
      támaszkodik — miközben a `server/README.md:5-7` „titkosított tárolást"
      ígér.

- [x] **K5 — A profil-mentés hitelesítés-orákulum, korlátozás nélkül.**
      `server/src/profiles/router.ts:152-164`: bármely Google-fiókkal belépett
      felhasználó tetszőleges `kretaUsername` + `password` + `instituteCode`
      hármast küldhet, és a válasz megkülönbözteti a sikeres és sikertelen
      belépést (`server/src/profiles/router.ts:158-163`). Nincs rate limit ezen
      az útvonalon — az egyetlen throttling az üzenőfalon van
      (`server/src/pledges/router.ts:91-92`).
      **Kockázat:** a szolgáltatás magyar iskolák KRÉTA IDP-je elleni
      credential-stuffing proxyként használható, a saját IP-nkről; a
      `server/README.md:232-234` sejti ezt, de a kódban semmi nem akadályozza.

## Fontos

- [ ] **F1 — Régió: csak a Cloud Run explicit, minden más alapértelmezésen.**
      Cloud Function nincs a projektben (nincs `functions/`, nincs
      `firebase-functions` függőség — `server/package.json:24-30`); a backend
      Cloud Run. Explicit: `server/firebase.json:36,40,44,48,52,56,60,64` és
      `server/README.md:98` — mind `europe-west1`. **Nincs** a repóban: a
      Firestore lokációja (`server/firebase.json:2-4` csak `rules`-t ad meg), a
      Cloud Scheduler job régiója (`server/README.md:109-114` kézzel hozandó
      létre), a Secret Manager replikációs policy, a Cloud Logging bucket
      lokációja, és a `--source` deploy által létrehozott Artifact Registry.
      Pub/Sub-ot a kód nem használ.
      **Kockázat:** ha a Firestore `nam5`-ben jött létre, kiskorúak iskolai adata
      az USA-ban van, miközben az `server/web/src/pages/iskolai-admin.astro:22`
      és `:158` az iskoláknak EU-t állít.

- [x] **F2 — `storage.rules` nincs a repóban, miközben a kliens ismer egy
      bucketet.**
      `server/firebase.json` csak `firestore` és `hosting` kulcsot tartalmaz;
      `server/storage.rules` nem létezik. A böngészőbe viszont bekerül a
      `storageBucket: "uzenofuzet.firebasestorage.app"`
      (`server/web/src/scripts/dashboard/firebase.ts:9`), és a deploy parancs
      (`server/README.md:129`) csak `firestore:rules,hosting`-ot tol ki.
      **Kockázat:** a bucket szabályai sosem a repóból származnak; régi
      alapértelmezés esetén bármely bejelentkezett Google-felhasználó írhat és
      olvashat. Lásd M4.

- [x] **F3 — Az Express alapértelmezett hibakezelője stack trace-t ír a
      stderr-re.**
      `server/src/app.ts` sehol nem regisztrál `(err, req, res, next)`
      middleware-t (a fájl `:162`-n `return app`-pel zárul), és a
      `server/src/mcp/route.ts:34` `.catch(next)`-tel adja tovább a hibákat. Az
      Express `finalhandler` minden kezeletlen hibát `console.error(err.stack)`
      -kel kiír, kivéve `NODE_ENV=test` esetén — a `server/Dockerfile:11` viszont
      `production`-t állít.
      **Kockázat:** ez az egyetlen kódbeli út, amin nem kontrollált szöveg juthat
      a Cloud Loggingba (undici `fetch failed` + `cause`, benne a
      `<intézménykód>.e-kreta.hu/...` URL; firebase-admin és MCP transport
      stackek).

- [ ] **F4 — A connector-token minden online gyereket visz, és a modell megkapja
      az összes testvér nevét.**
      `server/src/oauth/router.ts:299-303`: a session minden online profilt
      tartalmaz, a szülő nem tud egy gyerekre szűkíteni.
      `server/src/mcp/server.ts:177` a `kreta_login` válaszában felsorolja az
      összes gyereket; `server/src/mcp/context.ts:30` és `:36` hibaüzenetben adja
      ki az összes nevet.
      **Kockázat:** adatminimalizálási hiba — egyetlen tool-hívás is minden
      testvér nevét beviszi a beszélgetés-előzménybe.

- [ ] **F5 — Az Anthropicnak való továbbítás nincs az adatkezelési
      tájékoztatóban.**
      `server/web/src/pages/adatkezeles.astro` a „Szolgáltatók és kapcsolat"
      szakaszban csak Google Cloudot, Workspace-t és Firebase-t nevez meg; az
      Anthropic egyetlen tartalmi említése az iskolai admin oldalon van
      (`server/web/src/pages/iskolai-admin.astro:115`), amit a szülő soha nem
      lát. Közben a tényleges terminális adattároló az Anthropic
      (`server/src/mcp/server.ts:66`, `:95`).
      **Kockázat:** hiányzó GDPR 13. cikk szerinti tájékoztatás a címzettről és a
      harmadik országba történő továbbításról, pont a legérzékenyebb adatra.

- [ ] **F6 — Megőrzés: a „nincs határidő" opció korlátlan tárolást jelent, a
      takarítás pedig egy cronon múlik.**
      `server/web/src/scripts/child/keepAlive.ts:4,14` — a `"none"` választás
      `keepAliveUntil: null`-t ad, és `server/src/profiles/connection.ts:73`
      ilyenkor nem ír határidőt; a `server/src/profiles/refresher.ts:44` csak
      akkor zár le, ha van `keepAliveUntil`. Az egyéves felső korlát
      (`server/src/profiles/router.ts:143`) csak megadott dátumnál lép be. A
      lejárt trial-hitelesítőket kizárólag a Scheduler-job törli
      (`server/src/profiles/refresher.ts:39-42`).
      **Kockázat:** nincs kikényszerített megőrzési idő, és a „30 perc után
      törlődik" ígéret egy külső cron futásától függ; álló job mellett a
      ciphertext határozatlan ideig marad — és K3 miatt kibontható.

- [ ] **F7 — Nincs valódi „töröljetek mindent" folyamat.**
      Ami törlésre létezik: `DELETE /api/profiles/:id` → gyerekdoksi + queue-sor
      (`server/src/profiles/store.ts:389-398`), előtte token-visszavonási
      kísérlet (`server/src/profiles/router.ts:260-278`);
      `DELETE /api/profiles/:id/connection` → csak a `connection` mező
      (`server/src/profiles/store.ts:351-364`);
      `DELETE /api/classroom/:id/connection` → csak a `classroomConnection` mező
      (`server/src/classroom/router.ts:214-246`); `DELETE /api/pledges/me`
      (`server/src/pledges/router.ts:110`). **Nem** törlődik: a `users/{uid}`
      szülődokumentum, a Firebase Auth felhasználó, a kiadott MCP-tokenek (K2), a
      Cloud Logging és Hosting access logok, és a relay oldalán keletkezett
      bármi. A tájékoztató az üzenőfal törlését GitHub-kéréshez köti, pedig van
      rá API.
      **Kockázat:** egy szülői törlési kérésre ma nem lehet teljes körű választ
      adni, és a naplókra vonatkozó megőrzés sehol nincs kimondva.

- [x] **F8 — A `GET /api/pledges` hitelesítés nélkül nyilvános.**
      `server/src/pledges/router.ts:62-72`: a bearer token opcionális (`:65`), a
      lista mindig visszamegy — 50 rekord, benne a szülők Google-profilneve
      (`server/src/pledges/router.ts:45-49`, `server/src/pledges/store.ts:65`). Az
      útvonal él (`server/src/app.ts:86`) akkor is, ha a fal a UI-ból ki van
      kapcsolva (`server/README.md:15-19`).
      **Kockázat:** azonosítható felnőttek nevei és üzenetei bejelentkezés nélkül
      lekérhetők egy végpontról, amiről a termék azt hiszi, nincs is bekapcsolva.

- [ ] **F9 — Google authorization code kerül URL-be, tehát access logba.**
      `server/src/classroom/router.ts:136` — a
      `/api/classroom/callback?code=…&state=…` a Hosting és a Cloud Run
      kérésnaplójába is bekerül a query stringgel. A `state` pecsételt
      (`server/src/classroom/router.ts:121-127`), a `code` nyers.
      **Kockázat:** szabványos OAuth-viselkedés, de a napló így rövid életű
      hitelesítő adatot tárol; a `Referrer-Policy`
      (`server/firebase.json:15`) csak a böngészőoldalt fedi.

- [ ] **F10 — A replay-védelem processzenkénti, és ezt semmi nem kényszeríti
      ki.**
      `server/src/oauth/replayCache.ts:14-25` és `server/src/app.ts:119,146`
      memóriában tartja a felhasznált authorization code-okat és
      Classroom-state-eket. A `--max-instances=1` követelmény csak a
      `server/README.md:105-107`-ben él; a kódban nincs sem ellenőrzés, sem
      figyelmeztetés.
      **Kockázat:** egy skálázási beállítás csendes megváltoztatása
      egyszer-használatos artefaktumokat tesz többször felhasználhatóvá.

## Kozmetikai

- [ ] **C1** — `verifyIdToken` `checkRevoked` nélkül fut
      (`server/src/app.ts:66`), a session-süti viszont igen
      (`server/src/app.ts:82`): egy visszavont Google-fiók ID tokenje még ~1 óráig
      működik az `/api/*` végpontokon.
- [x] **C2** — `DELETE /api/session` (`server/src/auth/router.ts:62`) nem
      ellenőriz Origint, ellentétben a POST-tal (`server/src/auth/router.ts:25`):
      triviális CSRF-kijelentkeztetés.
- [ ] **C3** — `app.set("trust proxy", true)` (`server/src/app.ts:43`) minden
      proxy-fejlécet elhisz, és `OAUTH_ISSUER` hiányában az issuer a `Host`
      fejlécből jön (`server/src/app.ts:47-48`,
      `server/src/oauth/router.ts:40-44`) — ilyenkor a POST `/authorize`
      Origin-ellenőrzése (`server/src/oauth/router.ts:225`) önmagát hasonlítja a
      támadó által beállított értékhez. A `SameSite=Lax` süti
      (`server/src/auth/session.ts:23`) ma kivédi, de a védelem két független
      beállításon áll.
- [ ] **C4** — Az intézménykereső lekérdezései 10 percig memóriában maradnak
      (`server/src/institutes/router.ts:13,55`) — a tájékoztató korrektül leírja,
      csak a teljesség kedvéért szerepel.

---

## Kézzel ellenőrizendő

Kódból nem eldönthető (konzolbeállítás vagy runtime konfig). Mindegyik egy
parancs vagy egy konzolképernyő.

- [ ] **M1 — Fut-e egyáltalán relay, és hol.**
      `gcloud run services describe uzenofuzet --region europe-west1 --format='value(spec.template.spec.containers[0].env)'`
      — van-e `KRETA_RELAY_URL`? Ha igen: kié a gép, milyen tunnel van előtte
      (naplóz-e URL-t), van-e adatfeldolgozói szerződés. (K1)
- [ ] **M2 — Firestore lokáció.**
      `gcloud firestore databases describe --database='(default)' --format='value(locationId)'`
      — `eur3` vagy `europe-west*` kell. Ha `nam5`, az adat az USA-ban van, és a
      lokáció **utólag nem módosítható**. (F1)
- [ ] **M3 — Cloud Scheduler régió és target.**
      `gcloud scheduler jobs list --location=europe-west1` — ott van-e a job, és
      tényleg 5 percenként fut-e (`server/README.md:112`). Ha nincs, F6 miatt
      semmi nem takarít.
- [ ] **M4 — Firebase Storage szabályok.**
      Firebase Console → Storage → Rules a `uzenofuzet.firebasestorage.app`
      bucketen. Ha `allow read, write: if request.auth != null`, azonnal
      `if false`-ra, és `server/firebase.json`-ba felvenni egy
      `storage.rules`-t. (F2)
- [ ] **M5 — Secret Manager replikáció és hozzáférés.**
      `gcloud secrets describe uzenofuzet-sealing-key --format='value(replication)'`
      (user-managed, EU legyen) és
      `gcloud secrets get-iam-policy uzenofuzet-sealing-key` — ki tud
      `secretAccessor`-ként a K3 szerinti kulcshoz nyúlni.
- [ ] **M6 — Cloud Logging bucket lokációja és megőrzése.**
      `gcloud logging buckets describe _Default --location=global` — a `global`
      bucket nem EU-korlátos; érdemes EU-s bucketre irányítani és a 30 napos
      alapértelmezett retenciót tudatosan beállítani. (F3, F9)
- [ ] **M7 — Fut-e stack-trace-logolás.**
      `gcloud logging read 'resource.type="cloud_run_revision" AND textPayload:"    at "' --limit=20`
      — ha jönnek stack trace-ek, F3 valós, nem elméleti.
- [ ] **M8 — `--max-instances=1` tényleg érvényes-e.**
      `gcloud run services describe uzenofuzet --region europe-west1 --format='value(spec.template.metadata.annotations)'`
      — az `autoscaling.knative.dev/maxScale` legyen `1`. (F10)
- [ ] **M9 — `OAUTH_ISSUER` be van-e állítva.** Ugyanaz az env-lista, mint
      M1-nél. Ha üres, C3 aktív.
- [ ] **M10 — `REFRESH_JOB_AUDIENCE` / `REFRESH_JOB_SERVICE_ACCOUNT`.** Ha
      bármelyik hiányzik, `server/src/app.ts:124` miatt a
      `/internal/refresh-connections` mindig 401 — fail-closed, de akkor a
      token-frissítés és a takarítás sem fut.
- [ ] **M11 — A Cloud Run szolgáltatásfiók jogosultságai.**
      `gcloud run services describe … --format='value(spec.template.spec.serviceAccountName)'`,
      majd a projekt IAM-je. A `--source` deploy alapból a Compute default SA-t
      használja, ami *Editor* — ez a K3 kulcsához is hozzáférést jelenthet.
- [ ] **M12 — Firebase Auth: ki tud regisztrálni.** Console → Authentication →
      Settings. K5 miatt számít, hogy bárki nyithat-e fiókot; ha igen, a
      `PUT /api/profiles` bárki előtt nyitva áll.


---

## Kézi ellenőrzések eredménye (2026-09-05)

Mind a 12 tétel lefuttatva. A felénél a kockázat nem áll fenn.

| # | Eredmény | Következmény |
|---|---|---|
| M1 | `KRETA_RELAY_URL=https://kreta.uzenofuzet.hu/v1/fetch`, saját gép, Cloudflare Tunnel, Docker (`restart: unless-stopped`) | K1 áll, de nem külső fél: adatfeldolgozói szerződés tárgytalan. A tájékoztatásból viszont hiányzik. |
| M2 | Firestore `europe-west1` | **Rendben**, F1 tárolási fele igaz. |
| M3 | `uzenofuzet-connection-refresh`, `*/5 * * * *`, ENABLED | **Rendben**, F6 „nem fut a takarítás" fele megdől. |
| M4 | `gs://uzenofuzet.firebasestorage.app` **nem létezik** (404) | F2 kockázata tárgytalan; csak a halott kliens-konfig maradt — eltávolítva. |
| M5 | `uzenofuzet-sealing-key` replikáció **`automatic`** (globális), hozzáférés csak a runner SA-nak | **Nyitott:** a kulcs nem EU-ra rögzített, és a replikáció utólag nem módosítható — új titok + migráció kell. |
| M6 | `_Default` logbucket **`global`**, 30 nap, nem zárolt | **Nyitott:** a napló nem EU-korlátos. |
| M7 | Nulla stack trace, nulla ERROR az elmúlt 7 napban | F3 elméleti volt — a hibakezelő attól még beépítve. |
| M8 | `autoscaling.knative.dev/maxScale=1` | **Rendben**, F10 kockázata ma nem áll fenn (a kódban továbbra sincs kikényszerítve). |
| M9 | `OAUTH_ISSUER` be van állítva | **C3 nem aktív** — az issuer nem a Host fejlécből jön. |
| M10 | `REFRESH_JOB_AUDIENCE` és `REFRESH_JOB_SERVICE_ACCOUNT` is beállítva | **Rendben**, a frissítés és takarítás fut. |
| M11 | `uzenofuzet-runner@` SA, szerepkörei: `firebaseSessionIssuer` (egyedi) + `datastore.user` | **Rendben**, nem Editor. **De:** a Compute default SA-nak (`652545082668-compute@`) van `roles/editor` a projekten — érdemes elvenni, ha semmi nem használja. |
| M12 | Google-belépés bárki előtt nyitott (tervezetten) | K5 emiatt számított — a korlátozás beépítve. |

### Ebből fakadó új tétel

- [ ] **F11 — A titkosító kulcs és a naplók nem EU-ra rögzítettek.**
      A Secret Manager `automatic` replikációja globális (M5), a `_Default`
      logbucket `global` (M6). Az `/adatkezeles` viszont azt állítja, hogy „az
      adatkezelés az Európai Unión belül történik". A replikáció utólag nem
      módosítható: új, `user-managed` EU-replikációjú titkot kell létrehozni és
      átállni rá.

- [ ] **F12 — A Compute default szolgáltatásfióknak `roles/editor` jogosultsága van.**
      `652545082668-compute@developer.gserviceaccount.com`. A szolgáltatás nem
      ezt használja (M11), tehát elvehető.
