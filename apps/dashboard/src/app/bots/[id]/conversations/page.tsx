import { Card } from "@/components/Shell";
import { listConversations, listUnanswered } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [conversations, unanswered] = await Promise.all([
    listConversations(id),
    listUnanswered(id),
  ]);

  return (
    <>
      <Card
        title="What it could not answer"
        description="Refusals and thumbs-down together. The gate finds what is missing; a thumbs-down finds what is wrong, which the gate cannot see."
        actions={unanswered.length > 0 ? <span className="badge warn">{unanswered.length}</span> : undefined}
        flush
      >
        {unanswered.length === 0 ? (
          <div className="empty">
            <strong>Nothing yet</strong>
            No refusals and no negative feedback.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Question</th>
                  <th className="num">Asked</th>
                  <th>Why</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {unanswered.map((u) => (
                  <tr key={u.question}>
                    <td>{u.question}</td>
                    <td className="num">{u.occurrences}</td>
                    <td>
                      <span className={`badge ${u.thumbsDown ? "err" : "warn"}`}>
                        {u.thumbsDown ? "marked unhelpful" : "gated"}
                      </span>
                    </td>
                    <td className="muted small">{u.lastAsked.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Recent conversations"
        description={conversations.length === 1 ? "1 conversation" : `${conversations.length} conversations`}
        flush
      >
        {conversations.length === 0 ? (
          <div className="empty">
            <strong>No conversations yet</strong>
            They appear here once someone talks to the embedded bot.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Last question</th>
                  <th className="num">Turns</th>
                  <th>Origin</th>
                  <th>Signals</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id}>
                    <td>{c.lastQuestion || <span className="muted">—</span>}</td>
                    <td className="num">{c.turns}</td>
                    <td className="muted small">{c.origin ? new URL(c.origin).host : "—"}</td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {c.thumbsDown > 0 && <span className="badge err">{c.thumbsDown} unhelpful</span>}
                      {c.gated > 0 && <span className="badge warn">{c.gated} gated</span>}
                      {c.thumbsDown === 0 && c.gated === 0 && <span className="badge ok">clean</span>}
                    </td>
                    <td className="muted small">{c.createdAt.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
