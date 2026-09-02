---
name: kreta
description: Használd, ha a felhasználó a saját (vagy a gyereke) KRÉTA-adatairól kérdez — házi feladat, órarend, jegyek, dolgozatok, mulasztások, faliújság, fogadóóra, tanév rendje. Csak olvasás; a helyi gépen fut, a felhasználó saját KRÉTA-belépésével.
---

# KRÉTA lekérdezés

Ez a plugin egy helyi, csak olvasható KRÉTA-lekérdező scriptet
(`kreta_cli.py`) tartalmaz. A hitelesítő adatok (felhasználónév, jelszó,
intézménykód) a plugin mappájában lévő `.env` fájlból jönnek.

**Biztonság — kötelező betartani:**
- SOSE kérdezd meg a felhasználót a KRÉTA-jelszaváról a chatben.
- SOSE add át a jelszót parancssori argumentumként vagy bármilyen tool-hívás
  paramétereként — a script magától olvassa be a `.env`-ből.
- Ha a `.env` hiányzik vagy hiányos adatot tartalmaz, a script ezt jelzi;
  ekkor irányítsd a felhasználót, hogy a plugin mappájában töltse ki a
  `.env.example`-ből másolt `.env` fájlt (lásd lent, "Első használat").

## Használat

Futtasd a Bash tool-lal, a plugin mappájában (`${CLAUDE_PLUGIN_ROOT}`):

```bash
cd "${CLAUDE_PLUGIN_ROOT}" && uv run python kreta_cli.py <parancs> [kapcsolók]
```

Elérhető parancsok:

| Parancs | Mit ad |
|---|---|
| `login` | Belépés ellenőrzése (gyerek nélkül: az összes beállított gyerek) |
| `student-profile` | Tanuló adatlapja |
| `guardian-profile` | Gondviselői adatlap |
| `class-groups` | Osztályok és csoportok |
| `evaluations` | Jegyek és értékelések |
| `absences` | Mulasztások |
| `notes` | Feljegyzések |
| `announcements` | Faliújság |
| `timetable` | Órarend (alapból ±7 nap) |
| `timetable-item --uid UID` | Egy órarendi elem részletei |
| `homework` | Házi feladatok (alapból -30/+14 nap) |
| `homework-detail --uid UID` | Egy házi feladat részletei |
| `announced-tests` | Bejelentett dolgozatok (alapból -7/+30 nap) |
| `consulting-hours` | Fogadóórák (alapból +60 nap) |
| `consulting-hour-detail --uid UID` | Egy fogadóóra részletei |
| `school-calendar` | Tanév rendje |
| `week-schedule` | Intézményi hetirend |
| `class-averages` | Osztályátlagok |
| `device-status` | Eszközállapot |
| `lazar-ervin-events` | Lázár Ervin Program előadásai |

Közös kapcsolók:
- `--child NÉV` — melyik gyerekről legyen szó, ha több van beállítva. Ha a
  felhasználó névvel kérdez ("Mi van Marcinak a héten?"), add át. Ha csak
  egy gyerek van beállítva, ne add meg.
- `--limit N` — legfeljebb ennyi elem (alap 100, max 500), a lista-jellegű
  parancsoknál.
- `--start-date YYYY-MM-DD --end-date YYYY-MM-DD` — a dátumtartományt
  igénylő parancsoknál (timetable, homework, announced-tests,
  consulting-hours, week-schedule); enélkül az alapértelmezett tartományt
  használja.
- `--uid AZONOSÍTÓ` — a `*-detail` és `timetable-item` parancsokhoz; egy
  előző lista-lekérdezés válaszából kell venni.

A válasz JSON a stdoutra. Csak a kérdéshez szükséges mezőket emeld ki és
foglald össze természetes nyelven — ne öntsd ki a nyers JSON-t a
felhasználónak.

## Első használat

Ha a script hibát ad hiányzó hitelesítő adatra ("Hiányzó változó(k)..."),
mondd meg a felhasználónak: másolja a plugin mappájában lévő
`.env.example` fájlt `.env` néven, és töltse ki a saját KRÉTA
felhasználónevével, jelszavával és az iskola intézménykódjával (több
gyerekhez lásd a `.env.example` megjegyzéseit vagy a README "Több gyerek"
szakaszát). A plugin mappájának helyét te magad is megtalálod —
`${CLAUDE_PLUGIN_ROOT}` a plugin gyökere.
