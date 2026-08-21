"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Activating a pet morphs every embedded widget — no re-embed, no reload. */
export function PetActivator({
  botId, petId, isActive,
}: { botId: string; petId: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (isActive) return <span className="status ok">active</span>;

  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/bots/${botId}/pets`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ petId }),
        });
        router.refresh();
        setBusy(false);
      }}
    >
      {busy ? "…" : "Activate"}
    </button>
  );
}
