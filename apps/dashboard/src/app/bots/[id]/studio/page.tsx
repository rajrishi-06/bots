import { petSpecSchema, type PetSpec } from "@bots/core/pet";
import { notFound } from "next/navigation";
import { PetEditor } from "@/components/PetEditor";
import { listPets } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * The studio. Opens an existing pet when `?pet=` names one, otherwise starts
 * from the reference robot — a blank canvas is a worse starting point than a
 * working creature you can take apart.
 */
export default async function StudioPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pet?: string }>;
}) {
  const { id } = await params;
  const { pet: petId } = await searchParams;

  let initial: PetSpec | undefined;
  if (petId) {
    const pets = await listPets(id);
    const found = pets.find((p) => p.id === petId);
    if (!found) notFound();
    const parsed = petSpecSchema.safeParse(found.spec);
    // A stored spec that no longer parses would render as a blank canvas and
    // silently overwrite the original on save. Better to 404 than to eat it.
    if (!parsed.success) notFound();
    initial = parsed.data;
  }

  return <PetEditor botId={id} initial={initial} petId={petId} />;
}
