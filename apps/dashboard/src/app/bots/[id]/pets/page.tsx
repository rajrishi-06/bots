import { Card } from "@/components/Shell";
import { LivePet } from "@/components/LivePet";
import { PetActivator } from "@/components/PetActivator";
import { PetDesigner } from "@/components/PetDesigner";
import { listPets } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function PetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pets = await listPets(id);

  return (
    <>
      <Card title="Design a pet" description="Describe one in a sentence; the parts and palette are chosen for you.">
        <PetDesigner botId={id} />
      </Card>

      <Card
        title="Collection"
        description="One active at a time. Activating a different one morphs the embedded bot with no re-embed and no reload."
      >
        {pets.length === 0 ? (
          <div className="empty">
            <strong>No pets yet</strong>
            Describe one — “a sleepy lavender axolotl” — and the generator will
            pick parts and a palette, then check it for legibility on both light
            and dark pages.
          </div>
        ) : (
          <div className="grid-pets">
            {pets.map((p) => (
              <div className="pet-cell" key={p.id} data-active={p.isActive}>
                <LivePet spec={p.spec} />
                <span className="pet-name">{p.name}</span>
                <PetActivator botId={id} petId={p.id} isActive={p.isActive} />
                {p.createdFromPrompt && (
                  <span className="muted small">“{p.createdFromPrompt}”</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
