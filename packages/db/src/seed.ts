import { REFERENCE_PET, type PetSpec } from "@bots/core/pet";
import postgres from "postgres";

/**
 * Development seed. One org, one bot, a pet collection, and a small corpus.
 *
 * Idempotent by public key so it can be re-run. Prints the org id, which the
 * dashboard needs as DEV_ORG_ID until Clerk is wired in.
 */

const URL_ = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!URL_) throw new Error("Set MIGRATION_DATABASE_URL.");

const sql = postgres(URL_, { max: 2 });

const palette = (
  shellHi: string, shellLo: string, plateHi: string, plateLo: string,
  visorHi: string, visorLo: string, lit: string,
): PetSpec["palette"] => ({ shellHi, shellLo, plateHi, plateLo, visorHi, visorLo, lit });

const pets: { name: string; prompt: string; spec: PetSpec; active?: boolean }[] = [
  { name: "Terminal", prompt: "the original robot", spec: REFERENCE_PET },
  {
    name: "Lavi", prompt: "a sleepy lavender axolotl", active: true,
    spec: { ...REFERENCE_PET, name: "Lavi", skeleton: "stout",
      parts: { crown: "fin", head: "blob", torso: "egg", arms: "noodle", feet: "paws", face: "eyes" },
      palette: palette("#E6CCFF", "#8A5CD6", "#C4A0F0", "#6B3FA8", "#241040", "#0D0518", "#9BE8FF"),
      personality: { energy: 0.1, curiosity: 0.4, blurb: "Drifts through the digital currents." } },
  },
  {
    name: "Obsidian", prompt: "a sleek black cat with pointed ears",
    spec: { ...REFERENCE_PET, name: "Obsidian", skeleton: "balanced",
      parts: { crown: "none", head: "cat", torso: "capsule", arms: "noodle", feet: "paws", face: "eyes" },
      palette: palette("#8E93A8", "#31344A", "#5E6379", "#222434", "#12131C", "#07080C", "#7FE6C4"),
      personality: { energy: 0.7, curiosity: 0.95, blurb: "Watches. Judges. Occasionally approves." } },
  },
  {
    name: "AcidHop", prompt: "a neon acid-green tree frog",
    spec: { ...REFERENCE_PET, name: "AcidHop", skeleton: "bigHead",
      parts: { crown: "none", head: "blob", torso: "egg", arms: "noodle", feet: "paws", face: "goggles" },
      palette: palette("#C6F58A", "#4E8C22", "#9CD65C", "#356316", "#14240A", "#080F04", "#EAFF6B"),
      personality: { energy: 0.95, curiosity: 0.85, blurb: "Vibrating at all times." } },
  },
];

const KEY = "pb_live_demo";

const [existing] = await sql<{ id: string; org_id: string }[]>`
  SELECT id, org_id FROM bots WHERE public_key = ${KEY}`;

if (existing) {
  console.log(`Already seeded.\n\n  DEV_ORG_ID=${existing.org_id}\n`);
  await sql.end();
  process.exit(0);
}

const [org] = await sql`INSERT INTO organizations (name) VALUES ('Northwind') RETURNING id`;
const orgId = org!.id as string;

const [bot] = await sql`
  INSERT INTO bots (org_id, name, public_key, system_prompt, fallback_message, suggested_prompts, allowed_origins)
  VALUES (${orgId}, 'Northwind Support', ${KEY},
          'You are Northwind''s support assistant. Answer briefly and precisely.',
          'I do not have that in my knowledge base yet.',
          ARRAY['How long do EU customers have for a refund?','Which identity providers work with SSO?'],
          ARRAY[]::text[])
  RETURNING id`;
const botId = bot!.id as string;

for (const p of pets) {
  await sql`
    INSERT INTO pets (bot_id, name, spec, created_from_prompt, is_active)
    VALUES (${botId}, ${p.name}, ${sql.json(p.spec as never)}, ${p.prompt}, ${p.active ?? false})`;
}

console.log(`Seeded.

  DEV_ORG_ID=${orgId}
  bot        ${botId}
  public key ${KEY}
  pets       ${pets.length}

Ingest the eval corpus into it with:
  pnpm --filter @bots/eval bench     (creates its own throwaway bot)
`);

await sql.end();
