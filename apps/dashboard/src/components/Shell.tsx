import Link from "next/link";
import type { ReactNode } from "react";

/** Numbered sections and a margin rail, per DESIGN.md. No sidebar-and-cards. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header>
        <Link href="/" className="mark">bots</Link>
        <span className="u-label">studio</span>
      </header>
      {children}
    </div>
  );
}

export function Section({
  n, label, title, children, aside,
}: { n: string; label: string; title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <div className="rail">
        <div className="rail-label">
          <div className="u-label">§{n}</div>
          <div className="u-label">{label}</div>
          {aside}
        </div>
        <div>
          {title && <h2>{title}</h2>}
          {children}
        </div>
      </div>
    </section>
  );
}
