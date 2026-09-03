/**
 * The MCP server: the same read-only KRÉTA tools the local Python server
 * exposes (python/kreta_mcp_server.py), served over streamable HTTP against
 * a sealed session instead of a local .env.
 *
 * The tool surface is deliberately a fixed table of student GET endpoints.
 * There is no "call any KRÉTA path" tool, no write verb, and no attachment
 * download — what holds that line is this list, not a permission grant, so
 * adding to it is a product decision rather than a refactor.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BRAND } from "../brand.js";
import type { KretaClient } from "../kreta/client.js";
import { KretaError } from "../kreta/institute.js";
import type { SealedSession } from "../oauth/types.js";
import { createClient, resolveChild, ToolError, type ClientFactoryDeps } from "./context.js";
import { dateRange, MAX_ITEMS, pack, requireUid, studyTaskUids, validateLimit } from "./shape.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

const childArg = z
  .string()
  .optional()
  .describe("A gyerek neve, ahogy a csatlakoztatáskor megadtad. Egy gyereknél elhagyható.");
const limitArg = (fallback: number) =>
  z.number().int().min(1).max(MAX_ITEMS).default(fallback).describe("Legfeljebb ennyi elem.");
const dateArg = (what: string) => z.string().optional().describe(`${what} (YYYY-MM-DD).`);

export interface BuildServerOptions extends ClientFactoryDeps {
  session: SealedSession;
}

export function buildMcpServer(options: BuildServerOptions): McpServer {
  const { session, ...factoryDeps } = options;

  const server = new McpServer(
    { name: "kreta", version: "0.1.0" },
    {
      instructions:
        "A toolok érzékeny oktatási adatokat adhatnak vissza. Csak a felhasználó kifejezett " +
        "kérésére kérj le adatot, és csak a válaszhoz szükséges mezőket jelenítsd meg. " +
        "Módosító vagy törlő művelet nincs. Ha több gyerek van csatlakoztatva, minden tool " +
        "elfogad egy 'child' paramétert (a gyerek neve) — ha a felhasználó név szerint kérdez " +
        "('Mi van Marcinak?'), azt add át; ha egy tool 'child' nélkül hibát ad, a hibaüzenet " +
        "felsorolja az elérhető neveket.",
    },
  );

  /** Wraps a handler so every tool answers structured JSON and safe errors. */
  const tool = (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    handler: (args: Record<string, unknown>, client: () => KretaClient) => Promise<unknown>,
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: schema, annotations: { ...READ_ONLY, title: description } },
      async (args: Record<string, unknown>) => {
        try {
          const child = resolveChild(session, args.child as string | undefined);
          const payload = await handler(args, () => createClient(session, child, factoryDeps));
          return { content: [{ type: "text", text: JSON.stringify(payload) }] };
        } catch (error) {
          // KRÉTA and argument errors are safe, actionable Hungarian text.
          // Anything else is reported without its message, which could carry
          // a URL, a token fragment, or a stack path.
          const message =
            error instanceof ToolError || error instanceof KretaError
              ? error.message
              : "Váratlan hiba a KRÉTA-lekérdezés közben.";
          return { isError: true, content: [{ type: "text", text: message }] };
        }
      },
    );
  };

  /** A tool that is one GET returning a list. */
  const listTool = (
    name: string,
    description: string,
    path: string,
    defaultLimit = 100,
  ): void => {
    tool(name, description, { limit: limitArg(defaultLimit), child: childArg }, async (args, client) =>
      pack(await client().getJson(path), validateLimit(args.limit as number)),
    );
  };

  /** A tool that is one GET over a date range. */
  const rangeTool = (
    name: string,
    description: string,
    path: string,
    params: { from: string; to: string },
    defaults: { start: number; end: number },
  ): void => {
    tool(
      name,
      description,
      {
        start_date: dateArg("Kezdő dátum"),
        end_date: dateArg("Záró dátum"),
        limit: limitArg(100),
        child: childArg,
      },
      async (args, client) => {
        const typed = args as { start_date?: string; end_date?: string; limit: number };
        const { start, end } = dateRange(typed.start_date, typed.end_date, {
          defaultStartDays: defaults.start,
          defaultEndDays: defaults.end,
        });
        const data = await client().getJson(path, { [params.from]: start, [params.to]: end });
        return pack(data, validateLimit(typed.limit));
      },
    );
  };

  tool(
    "kreta_login",
    "A KRÉTA-kapcsolat ellenőrzése és a kapcsolat metaadatai.",
    { child: childArg },
    async (args, client) => {
      const instance = client();
      // The cheapest authenticated call: proves the refresh token still works.
      await instance.getJson("sajat/TanuloAdatlap");
      const child = resolveChild(session, args.child as string | undefined);
      return {
        authenticated: true,
        service: BRAND.name,
        label: child.label,
        institution: child.instituteCode,
        read_only: true,
        credential: "refresh_token",
        password_stored: false,
        token_storage: "sealed_in_client_token",
        connected_at: new Date(session.connectedAt).toISOString(),
        children: session.children.map((entry) => entry.label),
        // Surfaced because it is the one fact that decides whether a
        // storage-free deployment stays healthy (README, "Rotál-e...").
        refresh_token_rotation_observed: instance.rotationObserved,
      };
    },
  );

  tool("kreta_student_profile", "A tanuló adatlapjának lekérése.", { child: childArg }, async (_args, client) =>
    pack(await client().getJson("sajat/TanuloAdatlap")),
  );
  tool("kreta_guardian_profile", "A gondviselő adatlapjának lekérése.", { child: childArg }, async (_args, client) =>
    pack(await client().getJson("sajat/GondviseloAdatlap")),
  );

  listTool("kreta_class_groups", "A tanuló osztályainak és csoportjainak lekérése.", "sajat/OsztalyCsoportok");
  listTool("kreta_evaluations", "A tanuló értékeléseinek (jegyeinek) lekérése.", "sajat/Ertekelesek");
  listTool("kreta_absences", "A tanuló mulasztásainak lekérése.", "sajat/Mulasztasok");
  listTool("kreta_notes", "A tanulóhoz tartozó feljegyzések lekérése.", "sajat/Feljegyzesek");
  listTool("kreta_announcements", "A faliújság bejegyzéseinek lekérése.", "sajat/FaliujsagElemek");
  listTool(
    "kreta_school_calendar",
    "A tanév rendjének és intézményi napjainak lekérése.",
    "sajat/Intezmenyek/TanevRendjeElemek",
    200,
  );
  listTool("kreta_lazar_ervin_events", "A Lázár Ervin Programhoz tartozó előadások lekérése.", "Lep/Eloadasok");

  rangeTool(
    "kreta_timetable",
    "Az órarend lekérése egy időszakra.",
    "sajat/OrarendElemek",
    { from: "datumTol", to: "datumIg" },
    { start: 0, end: 7 },
  );
  rangeTool(
    "kreta_homework",
    "A házi feladatok lekérése egy időszakra.",
    "sajat/HaziFeladatok",
    { from: "datumTol", to: "datumIg" },
    { start: -7, end: 14 },
  );
  rangeTool(
    "kreta_announced_tests",
    "A bejelentett számonkérések lekérése egy időszakra.",
    "sajat/BejelentettSzamonkeresek",
    { from: "datumTol", to: "datumIg" },
    { start: 0, end: 30 },
  );
  rangeTool(
    "kreta_consulting_hours",
    "A fogadóórák lekérése egy időszakra.",
    "sajat/Fogadoorak",
    { from: "datumTol", to: "datumIg" },
    { start: 0, end: 30 },
  );
  rangeTool(
    "kreta_week_schedule",
    "Az intézményi heti órarendi beosztás lekérése.",
    "sajat/Intezmenyek/Hetirendek/Orarendi",
    { from: "orarendElemKezdoNapDatuma", to: "orarendElemVegNapDatuma" },
    { start: -7, end: 14 },
  );

  tool(
    "kreta_timetable_item",
    "Egy órarendi elem részleteinek lekérése.",
    { lesson_uid: z.string().describe("Az órarendi elem uid-ja."), child: childArg },
    async (args, client) =>
      pack(
        await client().getJson("sajat/OrarendElem", {
          orarendElemUid: requireUid(args.lesson_uid as string, "órarendi elem uid"),
        }),
      ),
  );

  tool(
    "kreta_homework_detail",
    "Egy házi feladat részleteinek lekérése.",
    { homework_uid: z.string().describe("A házi feladat uid-ja."), child: childArg },
    async (args, client) => {
      const uid = requireUid(args.homework_uid as string, "házi feladat uid");
      return pack(await client().getJson(`sajat/HaziFeladatok/${encodeURIComponent(uid)}`));
    },
  );

  tool(
    "kreta_consulting_hour_detail",
    "Egy fogadóóra részleteinek lekérése.",
    { consulting_hour_uid: z.string().describe("A fogadóóra uid-ja."), child: childArg },
    async (args, client) => {
      const uid = requireUid(
        args.consulting_hour_uid as string,
        "fogadóóra uid",
      );
      return pack(await client().getJson(`sajat/Fogadoorak/${encodeURIComponent(uid)}`));
    },
  );

  tool(
    "kreta_class_averages",
    "A tanuló csoportjaihoz elérhető osztályátlagok lekérése.",
    { limit: limitArg(100), child: childArg },
    async (args, client) => {
      const instance = client();
      const groups = await instance.getJson("sajat/OsztalyCsoportok");
      const averages: unknown[] = [];
      for (const uid of studyTaskUids(groups)) {
        // The mobile API expects this parameter twice at this endpoint.
        const data = await instance.getJson("sajat/Ertekelesek/Atlagok/OsztalyAtlagok", [
          ["oktatasiNevelesiFeladatUid", uid],
          ["oktatasiNevelesiFeladatUid", uid],
        ]);
        if (Array.isArray(data)) averages.push(...data);
        else if (data !== null && data !== undefined) averages.push(data);
      }
      return pack(averages, validateLimit(args.limit as number));
    },
  );

  tool(
    "kreta_device_status",
    "A tárgyi eszköz kiosztási és regisztrációs állapotának lekérése.",
    { child: childArg },
    async (_args, client) => {
      const instance = client();
      return {
        assigned: await instance.getJson("TargyiEszkoz/IsEszkozKiosztva"),
        registered: await instance.getJson("TargyiEszkoz/IsRegisztralt"),
      };
    },
  );

  return server;
}
