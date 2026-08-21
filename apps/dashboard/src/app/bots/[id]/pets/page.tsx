import { Section } from "@/components/Shell";
import { LivePet } from "@/components/LivePet";
import { PetActivator } from "@/components/PetActivator";
import { PetDesigner } from "@/components/PetDesigner";
import { listPets } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pets = await listPets(id);

  return (
    <Section
      n="03"
      label="Pets"
      title="Collection"
      aside={
        <p className="u-data" style={{ color: "var(--faint)", marginTop: 12 }}>
          One active at a time. Activating a different one morphs the embedded
          bot with no re-embed and no reload.
        </p>
      }
    >
      <PetDesigner botId={id} />

      {pets.length === 0 ? (
        <p className="empty-note">
          No pets yet. Describe one — “a sleepy lavender axolotl” — and the
          generator will pick parts and a palette, then check it for legibility
          on both light and dark pages.
        </p>
      ) : (
        <div className="grid-pets">
          {pets.map((p) => (
            <div className="pet-cell" key={p.id} data-active={p.isActive}>
              <LivePet spec={p.spec} />
              <span className="u-data">{p.name}</span>
              <PetActivator botId={id} petId={p.id} isActive={p.isActive} />
              {p.createdFromPrompt && (
                <span className="u-label" style={{ textTransform: "none", letterSpacing: 0 }}>
                  “{p.createdFromPrompt}”
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
