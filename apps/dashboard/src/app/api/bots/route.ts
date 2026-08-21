import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { getSession } from "@/lib/session";

/** POST /api/bots — create a bot. */

export const dynamic = "force-dynamic";

let pool: postgres.Sql | undefined;

/**
 * `pb_live_` + 24 random chars.
 *
 * This is an IDENTIFIER, not a secret — it ships in the embed snippet and
 * anyone can read it off a customer's page. It is generated from a CSPRNG
 * anyway, because a guessable key would let someone enumerate bots and burn
 * their quota, which the origin allowlist would stop but the rate limiter
 * would have to absorb first.
 */
const publicKey = (): string => `pb_live_${randomBytes(18).toString("base64url").slice(0, 24)}`;

export async function POST(request: Request) {
  const { orgId } = await getSession();
  const { name } = (await request.json()) as { name?: string };
  if (!name?.trim()) return NextResponse.json({ error: "A name is required." }, { status: 400 });

  pool ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 4 });

  const created = await pool.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.org_id = '${orgId}'`);
    const bots = await tx<{ id: string }[]>`
      INSERT INTO bots (org_id, name, public_key, system_prompt, fallback_message, suggested_prompts)
      VALUES (${orgId}, ${name.trim()}, ${publicKey()},
              ${`You are ${name.trim()}'s assistant. Answer briefly and precisely.`},
              'I don''t have that in my knowledge base yet.',
              ARRAY[]::text[])
      RETURNING id`;
    const botId = bots[0]!.id;

    // A bot with no pet renders the reference one, but giving it a real row up
    // front means the gallery is never empty and "activate a different pet" is
    // discoverable from the first visit.
    await tx.unsafe(`SET LOCAL app.bot_id = '${botId}'`);
    await tx`
      INSERT INTO pets (bot_id, name, spec, is_active)
      VALUES (${botId}, 'Terminal', ${tx.json({
        v: 1, name: "Terminal", theme: "robot", skeleton: "balanced",
        parts: { crown: "antenna", head: "round", torso: "capsule", arms: "stub", feet: "pads", face: "visor" },
        palette: { shellHi: "#C3CDFB", shellLo: "#6376DD", plateHi: "#8493EA", plateLo: "#4B5CC6",
                   visorHi: "#1A2242", visorLo: "#070B1A", lit: "#7FC0FF" },
        personality: { energy: 0.55, curiosity: 0.8, blurb: "Watchful, dry, quietly pleased to be useful." },
      } as never)}, true)`;
    return botId;
  });

  return NextResponse.json({ id: created });
}
