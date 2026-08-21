"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["", "Overview"],
  ["playground", "Playground"],
  ["pets", "Pets"],
  ["knowledge", "Knowledge"],
  ["conversations", "Monitor"],
  ["embed", "Embed"],
] as const;

export function BotTabs({ id }: { id: string }) {
  const path = usePathname();
  return (
    <nav className="tabs">
      {TABS.map(([slug, label]) => {
        const href = slug ? `/bots/${id}/${slug}` : `/bots/${id}`;
        return (
          <Link key={slug} href={href} data-active={path === href}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
