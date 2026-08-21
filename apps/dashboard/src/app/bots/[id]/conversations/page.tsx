import { Section } from "@/components/Shell";
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
      <Section
        n="07"
        label="Gaps"
        title="What it could not answer"
        aside={
          <p className="u-data" style={{ color: "var(--faint)", marginTop: 12 }}>
            Refusals and thumbs-down together. The gate finds what is missing; a
            thumbs-down finds what is wrong, which the gate cannot see.
          </p>
        }
      >
        {unanswered.length === 0 ? (
          <p className="empty-note">Nothing yet — no refusals and no negative feedback.</p>
        ) : (
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
                    <span className={`status ${u.thumbsDown ? "err" : "warn"}`}>
                      {u.thumbsDown ? "marked unhelpful" : "gated"}
                    </span>
                  </td>
                  <td className="u-data" style={{ color: "var(--faint)" }}>
                    {u.lastAsked.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section n="08" label="Conversations" title="Recent">
        {conversations.length === 0 ? (
          <p className="empty-note">No conversations yet.</p>
        ) : (
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
                  <td>{c.lastQuestion || <span style={{ color: "var(--faint)" }}>—</span>}</td>
                  <td className="num">{c.turns}</td>
                  <td className="u-data" style={{ color: "var(--faint)" }}>
                    {c.origin ? new URL(c.origin).host : "—"}
                  </td>
                  <td>
                    {c.thumbsDown > 0 && <span className="status err">{c.thumbsDown} unhelpful</span>}
                    {c.gated > 0 && <span className="status warn">{c.gated} gated</span>}
                    {c.thumbsDown === 0 && c.gated === 0 && <span className="status ok">clean</span>}
                  </td>
                  <td className="u-data" style={{ color: "var(--faint)" }}>
                    {c.createdAt.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
