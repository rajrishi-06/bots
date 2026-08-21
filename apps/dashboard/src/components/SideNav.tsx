"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { JSX } from "react";

/** Bot-scoped navigation. Hidden until a bot is open — there is nothing to
 *  navigate before then, and an empty rail reads as broken. */
const ITEMS: [slug: string, label: string, icon: JSX.Element][] = [
  ["", "Overview", icon("M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z")],
  ["playground", "Playground", icon("M4 10h12M10 4v12")],
  ["pets", "Pets", icon("M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM14 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM10 17c-3 0-5-2-5-4s2-4 5-4 5 2 5 4-2 4-5 4z")],
  ["knowledge", "Knowledge", icon("M4 4h9l3 3v9H4zM13 4v3h3")],
  ["conversations", "Monitor", icon("M3 10a7 7 0 1 1 3 5.7L3 17l1.2-3A7 7 0 0 1 3 10z")],
  ["embed", "Embed", icon("M7 6 3 10l4 4M13 6l4 4-4 4")],
];

function icon(d: string): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function SideNav({ botId }: { botId?: string }) {
  const path = usePathname();

  if (!botId) {
    return (
      <>
        <div className="nav-label">Workspace</div>
        <Link href="/" className="nav-item" data-active={path === "/"}>
          {icon("M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z")}
          All bots
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="nav-label">Workspace</div>
      <Link href="/" className="nav-item">
        {icon("M12 4 6 10l6 6")}
        All bots
      </Link>

      <div className="nav-label">Bot</div>
      {ITEMS.map(([slug, label, glyph]) => {
        const href = slug ? `/bots/${botId}/${slug}` : `/bots/${botId}`;
        return (
          <Link key={slug} href={href} className="nav-item" data-active={path === href}>
            {glyph}
            {label}
          </Link>
        );
      })}
    </>
  );
}
