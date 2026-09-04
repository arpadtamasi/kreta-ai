export class ClassroomApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ClassroomApiError";
  }
}

export class ClassroomClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getJson(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const url = new URL(path.replace(/^\/+/, ""), "https://classroom.googleapis.com/v1/");
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
      });
    } catch {
      throw new ClassroomApiError(503, "A Google Classroom most nem érhető el.");
    }
    if (!response.ok) {
      const message = response.status === 401
        ? "A Classroom-kapcsolat lejárt. Kapcsold össze újra ezt a gyereket a kapcsolati pulton."
        : response.status === 403
          ? "A gyerek Google-fiókja vagy az iskola rendszergazdája nem engedi ezt a Classroom-lekérdezést."
          : response.status === 404
            ? "A kért Classroom-kurzus vagy bejegyzés nem található."
            : "A Google Classroom-lekérdezés most nem sikerült.";
      throw new ClassroomApiError(response.status, message);
    }
    return response.json().catch(() => ({}));
  }

  async list(
    path: string,
    responseKey: string,
    params: Record<string, string | number | undefined>,
    limit: number,
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.getJson(path, { ...params, pageSize: Math.min(100, limit - items.length), pageToken }) as Record<string, unknown>;
      const page = data[responseKey];
      if (Array.isArray(page)) items.push(...page.slice(0, limit - items.length));
      pageToken = typeof data.nextPageToken === "string" && items.length < limit ? data.nextPageToken : undefined;
    } while (pageToken);
    return items;
  }
}
