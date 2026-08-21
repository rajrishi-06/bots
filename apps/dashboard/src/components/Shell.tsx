import Link from "next/link";
import type { ReactNode } from "react";
import { SideNav } from "./SideNav";

/** App shell: persistent left rail, sticky header, cards in the main column. */
export function Shell({
  botId, crumbs, actions, children,
}: {
  botId?: string;
  crumbs: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/" className="brand-mark">
          <span className="brand-dot" aria-hidden />
          bots
        </Link>
        <SideNav botId={botId} />
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">{crumbs}</div>
          {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export function Card({
  title, description, actions, children, flush,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && (
              <p className="muted small" style={{ marginTop: 2 }}>
                {description}
              </p>
            )}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? "card-body flush" : "card-body"}>{children}</div>
    </section>
  );
}
