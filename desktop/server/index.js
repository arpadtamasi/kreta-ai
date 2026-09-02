#!/usr/bin/env node
/**
 * Helyi, csak olvasható MCP szerver a KRÉTA Tanulói API-hoz
 * (a kreta_mcp_server.py portja Claude Desktop bővítményhez).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadChildren } from "./config.js";
import { KretaError } from "./kreta-auth.js";
import { KretaClient } from "./kreta-client.js";

const MAX_ITEMS = 500;
const MAX_RANGE_DAYS = 93;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

let childrenCache = null;
const clients = new Map();

function children() {
  if (childrenCache === null) childrenCache = loadChildren();
  return childrenCache;
}

/** A megfelelő gyerek kliense; több gyereknél kötelező és ellenőrzött a név. */
function getClient(child) {
  const all = children();
  let credentials;
  if (all.length === 1) {
    [credentials] = all;
  } else {
    const wanted = (child ?? "").trim();
    const names = all.map((c) => c.label).join(", ");
    if (!wanted) {
      throw new KretaError(
        `Több gyerek van beállítva (${names}) — add meg, melyikről legyen ` +
          "szó a 'child' paraméterrel.",
      );
    }
    credentials = all.find(
      (c) => c.label.toLowerCase() === wanted.toLowerCase(),
    );
    if (!credentials) {
      throw new KretaError(
        `Nincs ilyen néven beállított gyerek: '${wanted}'. Elérhető nevek: ${names}.`,
      );
    }
  }
  const key = credentials.label || credentials.username;
  if (!clients.has(key)) clients.set(key, new KretaClient(credentials));
  return clients.get(key);
}

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEMS) {
    throw new KretaError(`A limit 1 és ${MAX_ITEMS} közötti egész szám legyen.`);
  }
  return limit;
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function dateRange(startDate, endDate, defaultStartDays, defaultEndDays = 0) {
  const today = new Date();
  const shifted = (days) =>
    new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  const parse = (value, fallbackDays) => {
    if (!value) return shifted(fallbackDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
      throw new KretaError("A dátum formátuma YYYY-MM-DD legyen.");
    }
    return new Date(`${value}T00:00:00Z`);
  };
  const start = parse(startDate, defaultStartDays);
  const end = parse(endDate, defaultEndDays);
  if (end < start) {
    throw new KretaError("A záró dátum nem lehet korábbi a kezdő dátumnál.");
  }
  if ((end - start) / (24 * 60 * 60 * 1000) > MAX_RANGE_DAYS) {
    throw new KretaError(`Legfeljebb ${MAX_RANGE_DAYS} napos időszak kérhető le.`);
  }
  return [isoDate(start), isoDate(end)];
}

function pack(data, limit = null) {
  if (Array.isArray(data)) {
    const safeLimit = validateLimit(limit ?? MAX_ITEMS);
    const items = data.slice(0, safeLimit);
    return {
      items,
      returned: items.length,
      total: data.length,
      truncated: items.length < data.length,
    };
  }
  return { data };
}

function uid(value, label) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new KretaError(`Érvénytelen ${label}.`);
  }
  return normalized;
}

function studyTaskUids(groups) {
  if (!Array.isArray(groups)) return [];
  const result = [];
  for (const group of groups) {
    const task = group?.OktatasNevelesiFeladat;
    const rawUid = task?.Uid ?? task?.uid;
    if (rawUid === undefined || rawUid === null) continue;
    const normalized = String(rawUid).split(",", 1)[0];
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

const server = new McpServer(
  { name: "kreta", title: "KRÉTA (csak olvasás)", version: "0.4.0" },
  {
    instructions:
      "A toolok érzékeny oktatási adatokat adhatnak vissza. Csak a felhasználó " +
      "kifejezett kérésére kérj le adatot, és csak a válaszhoz szükséges mezőket " +
      "jelenítsd meg. Módosító vagy törlő művelet nincs. Ha több gyerek van " +
      "beállítva, minden tool elfogad egy 'child' paramétert (a gyerek nevét) " +
      "— ha a felhasználó név szerint kérdez ('Mi van Marcinak?'), azt add át; " +
      "ha egy tool 'child' nélkül hibát ad a több gyerek miatt, a hibaüzenet " +
      "felsorolja az elérhető neveket.",
  },
);

const childParam = z
  .string()
  .optional()
  .describe("A gyerek beállított neve (több gyerek esetén kötelező).");
const limitParam = (def) =>
  z.number().int().optional().default(def).describe("Legfeljebb ennyi elem.");
const dateParam = (label) =>
  z.string().optional().describe(`${label} (YYYY-MM-DD).`);

/** Tool regisztrálása: a KretaError-t rövid, felhasználóbarát hibává alakítja. */
function tool(name, description, schema, handler) {
  server.registerTool(
    name,
    { description, inputSchema: schema, annotations: READ_ONLY },
    async (args) => {
      try {
        const result = await handler(args ?? {});
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        if (error instanceof KretaError) {
          return { isError: true, content: [{ type: "text", text: error.message }] };
        }
        throw error;
      }
    },
  );
}

tool(
  "kreta_login",
  "Belépés ellenőrzése OAuth 2.0 Authorization Code + PKCE használatával. " +
    "Ha nincs 'child' megadva és több gyerek van beállítva, mindegyiket " +
    "ellenőrzi, és gyerekenkénti státuszt ad vissza.",
  { child: childParam },
  async ({ child }) => {
    const all = children();
    if (child === undefined && all.length > 1) {
      const result = {};
      for (const c of all) {
        try {
          result[c.label] = await getClient(c.label).status();
        } catch (error) {
          if (!(error instanceof KretaError)) throw error;
          result[c.label] = { authenticated: false, error: error.message };
        }
      }
      return result;
    }
    return getClient(child).status();
  },
);

tool(
  "kreta_student_profile",
  "A bejelentkezett tanuló adatlapjának lekérése.",
  { child: childParam },
  async ({ child }) => pack(await getClient(child).getJson("sajat/TanuloAdatlap")),
);

tool(
  "kreta_guardian_profile",
  "A bejelentkezett fiók gondviselői adatlapjának lekérése.",
  { child: childParam },
  async ({ child }) =>
    pack(await getClient(child).getJson("sajat/GondviseloAdatlap")),
);

tool(
  "kreta_class_groups",
  "A tanuló osztályainak és csoportjainak lekérése.",
  { limit: limitParam(100), child: childParam },
  async ({ limit, child }) =>
    pack(await getClient(child).getJson("sajat/OsztalyCsoportok"), limit),
);

tool(
  "kreta_evaluations",
  "Jegyek és más értékelések lekérése, legfeljebb a megadott darabszámban.",
  { limit: limitParam(100), child: childParam },
  async ({ limit, child }) =>
    pack(await getClient(child).getJson("sajat/Ertekelesek"), limit),
);

tool(
  "kreta_absences",
  "Mulasztások és igazolási állapotuk lekérése.",
  { limit: limitParam(100), child: childParam },
  async ({ limit, child }) =>
    pack(await getClient(child).getJson("sajat/Mulasztasok"), limit),
);

tool(
  "kreta_notes",
  "Tanári és intézményi feljegyzések lekérése.",
  { limit: limitParam(100), child: childParam },
  async ({ limit, child }) =>
    pack(await getClient(child).getJson("sajat/Feljegyzesek"), limit),
);

tool(
  "kreta_announcements",
  "A KRÉTA faliújság-elemeinek lekérése.",
  { limit: limitParam(100), child: childParam },
  async ({ limit, child }) =>
    pack(await getClient(child).getJson("sajat/FaliujsagElemek"), limit),
);

tool(
  "kreta_timetable",
  "Órarend lekérése egy YYYY-MM-DD dátumtartományra (alapból ±7 nap).",
  {
    start_date: dateParam("Kezdő dátum"),
    end_date: dateParam("Záró dátum"),
    limit: limitParam(200),
    child: childParam,
  },
  async ({ start_date, end_date, limit, child }) => {
    const [start, end] = dateRange(start_date, end_date, -7, 7);
    return pack(
      await getClient(child).getJson("sajat/OrarendElemek", {
        datumTol: start,
        datumIg: end,
      }),
      limit,
    );
  },
);

tool(
  "kreta_timetable_item",
  "Egy órarendi elem részleteinek lekérése a listából kapott UID alapján.",
  { lesson_uid: z.string().describe("Az órarendi elem UID-ja."), child: childParam },
  async ({ lesson_uid, child }) =>
    pack(
      await getClient(child).getJson("sajat/OrarendElem", {
        orarendElemUid: uid(lesson_uid, "órarendi UID"),
      }),
    ),
);

tool(
  "kreta_homework",
  "Házi feladatok lekérése dátumtartományra (alapból az elmúlt 30 és következő 14 nap).",
  {
    start_date: dateParam("Kezdő dátum"),
    end_date: dateParam("Záró dátum"),
    limit: limitParam(100),
    child: childParam,
  },
  async ({ start_date, end_date, limit, child }) => {
    const [start, end] = dateRange(start_date, end_date, -30, 14);
    return pack(
      await getClient(child).getJson("sajat/HaziFeladatok", {
        datumTol: start,
        datumIg: end,
      }),
      limit,
    );
  },
);

tool(
  "kreta_homework_detail",
  "Egy házi feladat részleteinek lekérése a listából kapott UID alapján.",
  { homework_uid: z.string().describe("A házi feladat UID-ja."), child: childParam },
  async ({ homework_uid, child }) =>
    pack(
      await getClient(child).getJson(
        `sajat/HaziFeladatok/${encodeURIComponent(uid(homework_uid, "házi feladat UID"))}`,
      ),
    ),
);

tool(
  "kreta_announced_tests",
  "Bejelentett dolgozatok és számonkérések lekérése dátumtartományra.",
  {
    start_date: dateParam("Kezdő dátum"),
    end_date: dateParam("Záró dátum"),
    limit: limitParam(100),
    child: childParam,
  },
  async ({ start_date, end_date, limit, child }) => {
    const [start, end] = dateRange(start_date, end_date, -7, 30);
    return pack(
      await getClient(child).getJson("sajat/BejelentettSzamonkeresek", {
        datumTol: start,
        datumIg: end,
      }),
      limit,
    );
  },
);

tool(
  "kreta_consulting_hours",
  "Fogadóórák lekérése dátumtartományra.",
  {
    start_date: dateParam("Kezdő dátum"),
    end_date: dateParam("Záró dátum"),
    limit: limitParam(100),
    child: childParam,
  },
  async ({ start_date, end_date, limit, child }) => {
    const [start, end] = dateRange(start_date, end_date, 0, 60);
    return pack(
      await getClient(child).getJson("sajat/Fogadoorak", {
        datumTol: start,
        datumIg: end,
      }),
      limit,
    );
  },
);

tool(
  "kreta_consulting_hour_detail",
  "Egy fogadóóra részleteinek lekérése a listából kapott UID alapján.",
  {
    consulting_hour_uid: z.string().describe("A fogadóóra UID-ja."),
    child: childParam,
  },
  async ({ consulting_hour_uid, child }) =>
    pack(
      await getClient(child).getJson(
        `sajat/Fogadoorak/${encodeURIComponent(uid(consulting_hour_uid, "fogadóóra UID"))}`,
      ),
    ),
);

tool(
  "kreta_school_calendar",
  "A tanév rendjének és intézményi napjainak lekérése.",
  { limit: limitParam(200), child: childParam },
  async ({ limit, child }) =>
    pack(
      await getClient(child).getJson("sajat/Intezmenyek/TanevRendjeElemek"),
      limit,
    ),
);

tool(
  "kreta_week_schedule",
  "Az intézményi heti órarendi beosztás lekérése.",
  {
    start_date: dateParam("Kezdő dátum"),
    end_date: dateParam("Záró dátum"),
    limit: limitParam(100),
    child: childParam,
  },
  async ({ start_date, end_date, limit, child }) => {
    const [start, end] = dateRange(start_date, end_date, -7, 14);
    return pack(
      await getClient(child).getJson("sajat/Intezmenyek/Hetirendek/Orarendi", {
        orarendElemKezdoNapDatuma: start,
        orarendElemVegNapDatuma: end,
      }),
      limit,
    );
  },
);

tool(
  "kreta_class_averages",
  "A tanuló csoportjaihoz elérhető osztályátlagok lekérése.",
  { limit: limitParam(100), child: childParam },
  async ({ limit, child }) => {
    const client = getClient(child);
    const groups = await client.getJson("sajat/OsztalyCsoportok");
    const allAverages = [];
    for (const studyTaskUid of studyTaskUids(groups)) {
      // A mobil API ugyanazt a paramétert kétszer várja ennél a végpontnál.
      const data = await client.getJson(
        "sajat/Ertekelesek/Atlagok/OsztalyAtlagok",
        [
          ["oktatasiNevelesiFeladatUid", studyTaskUid],
          ["oktatasiNevelesiFeladatUid", studyTaskUid],
        ],
      );
      if (Array.isArray(data)) allAverages.push(...data);
      else if (data !== null) allAverages.push(data);
    }
    return pack(allAverages, limit);
  },
);

tool(
  "kreta_device_status",
  "A KRÉTA tárgyi eszköz kiosztási és regisztrációs állapotának lekérése.",
  { child: childParam },
  async ({ child }) => {
    const client = getClient(child);
    return {
      assigned: await client.getJson("TargyiEszkoz/IsEszkozKiosztva"),
      registered: await client.getJson("TargyiEszkoz/IsRegisztralt"),
    };
  },
);

tool(
  "kreta_lazar_ervin_events",
  "A Lázár Ervin Programhoz tartozó előadások lekérése.",
  { limit: limitParam(100), child: childParam },
  async ({ limit, child }) =>
    pack(await getClient(child).getJson("Lep/Eloadasok"), limit),
);

async function shutdown() {
  const closing = [...clients.values()].map((client) => client.close());
  clients.clear();
  await Promise.allSettled(closing);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
