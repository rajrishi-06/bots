"use client";

import { useState } from "react";

export function EmbedSnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <pre className="mono">{snippet}</pre>
      <button
        className="btn"
        onClick={async () => {
          await navigator.clipboard.writeText(snippet);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <style jsx>{`
        pre {
          border: 1px solid var(--border);
          background: var(--surface);
          padding: 14px;
          overflow-x: auto;
          margin: 0 0 10px;
          white-space: pre;
        }
      `}</style>
    </div>
  );
}
