import { groundingModeSchema, requiresAck } from "@bots/core/rag";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

let pool: postgres.Sql | undefined;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const body = (await request.json()) as { mode?: unknown; acknowledged?: boolean };

  const parsed = groundingModeSchema.safeParse(body.mode);
  if (!parsed.success) return NextResponse.json({ error: "Unknown grounding mode." }, { status: 400 });
  const mode = parsed.data;

  // Refused server-side, not just hidden in the UI: the acknowledgement is a
  // liability record, and a client that skips the dialog must not be able to
  // skip the record with it.
  if (requiresAck(mode) && !body.acknowledged) {
    return NextResponse.json(
      { error: "This mode requires acknowledging its cost and liability risks." },
      { status: 400 },
    );
  }

  pool ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });
  const updated = await pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.org_id = '${session.orgId}'`);
    return tx`
      UPDATE bots
      SET grounding_mode = ${mode},
          grounding_mode_ack_at = ${requiresAck(mode) ? new Date() : null},
          grounding_mode_ack_by = ${requiresAck(mode) ? session.userId : null}
      WHERE id = ${id}
      RETURNING id`;
  });

  if ((updated as unknown[]).length === 0) {
    return NextResponse.json({ error: "Unknown bot." }, { status: 404 });
  }
  return NextResponse.json({ mode });
}
