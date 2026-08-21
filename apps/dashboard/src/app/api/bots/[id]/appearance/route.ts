import { actionsSchema, appearanceSchema, usableActions } from "@bots/core/widget";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

let pool: postgres.Sql | undefined;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await getSession();
  const body = (await request.json()) as { appearance?: unknown; actions?: unknown };

  const appearance = appearanceSchema.safeParse(body.appearance ?? {});
  if (!appearance.success) {
    return NextResponse.json({ error: appearance.error.issues[0]?.message ?? "Invalid appearance." }, { status: 400 });
  }

  const actions = actionsSchema.safeParse(body.actions ?? []);
  if (!actions.success) {
    return NextResponse.json({ error: actions.error.issues[0]?.message ?? "Invalid actions." }, { status: 400 });
  }

  // Unsafe links are rejected loudly here rather than silently dropped: the
  // owner typed it and needs to know it will not be shown.
  const usable = usableActions(actions.data);
  if (usable.length !== actions.data.length) {
    return NextResponse.json(
      { error: "Links must be https:// — anything else is refused." },
      { status: 400 },
    );
  }

  pool ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });
  const updated = await pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
    return tx`
      UPDATE bots SET appearance = ${tx.json(appearance.data as never)},
                      actions = ${tx.json(usable as never)}
      WHERE id = ${id} RETURNING id`;
  });

  if ((updated as unknown[]).length === 0) {
    return NextResponse.json({ error: "Unknown bot." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
