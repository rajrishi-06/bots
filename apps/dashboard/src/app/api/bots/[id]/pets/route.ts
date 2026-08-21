import { GeminiProvider } from "@bots/core/models";
import { generatePet, petSpecSchema, validatePetPalette } from "@bots/core/pet";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { getSession } from "@/lib/session";

/**
 * Pet generation and activation.
 *
 * POST   { prompt }            → generate a spec (not saved)
 * POST   { spec, name }        → save it to the collection
 * POST   { spec, name, petId } → overwrite an existing pet (the editor)
 * PATCH  { petId }             → make it the active one
 */

export const dynamic = "force-dynamic";

let pool: postgres.Sql | undefined;
function db(): postgres.Sql {
  pool ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });
  return pool;
}

async function scoped<T>(botId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const { orgId } = await getSession();
  return db().begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
    await tx.unsafe(`SET LOCAL app.bot_id = '${botId}'`);
    return fn(tx);
  }) as Promise<T>;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as { prompt?: string; spec?: unknown; name?: string; petId?: string };

  // Generate. Returns the spec WITHOUT saving, so the designer can preview and
  // re-roll without filling the collection with rejects.
  if (body.prompt) {
    try {
      const { spec, attempts } = await generatePet(new GeminiProvider(), { prompt: body.prompt });
      return NextResponse.json({ spec, attempts });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Generation failed." },
        { status: 502 },
      );
    }
  }

  // Save. Re-validated server-side: the client could have edited the spec, and
  // a palette that fails the contrast gate is invisible on somebody's site.
  const parsed = petSpecSchema.safeParse(body.spec);
  if (!parsed.success) return NextResponse.json({ error: "Invalid pet spec." }, { status: 400 });

  const verdict = validatePetPalette(parsed.data.palette);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: "Palette is not legible.", issues: verdict.issues },
      { status: 400 },
    );
  }

  // Overwrite an existing pet — the editor saving over what it opened.
  // `created_from_prompt` is deliberately untouched: it records where the pet
  // came from, and hand-editing it later does not change that history.
  if (body.petId) {
    const updated = await scoped(id, (tx) =>
      tx<{ id: string }[]>`
        UPDATE pets SET name = ${body.name ?? parsed.data.name},
                        spec = ${tx.json(parsed.data as never)}
        WHERE id = ${body.petId!} AND bot_id = ${id}
        RETURNING id`,
    );
    if (updated.length === 0) return NextResponse.json({ error: "No such pet." }, { status: 404 });
    return NextResponse.json({ petId: updated[0]!.id });
  }

  const rows = await scoped(id, (tx) =>
    tx<{ id: string }[]>`
      INSERT INTO pets (bot_id, name, spec, created_from_prompt, is_active)
      VALUES (${id}, ${body.name ?? parsed.data.name}, ${tx.json(parsed.data as never)},
              ${body.name ? null : parsed.data.name}, false)
      RETURNING id`,
  );
  return NextResponse.json({ petId: rows[0]?.id });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { petId } = (await request.json()) as { petId?: string };
  if (!petId) return NextResponse.json({ error: "petId is required." }, { status: 400 });

  await scoped(id, async (tx) => {
    // Deactivate then activate, in ONE transaction. A partial unique index
    // enforces at most one active pet, so doing this in two statements outside a
    // transaction would transiently violate it and fail.
    await tx`UPDATE pets SET is_active = false WHERE bot_id = ${id} AND is_active`;
    await tx`UPDATE pets SET is_active = true WHERE id = ${petId} AND bot_id = ${id}`;
  });

  return NextResponse.json({ ok: true });
}
