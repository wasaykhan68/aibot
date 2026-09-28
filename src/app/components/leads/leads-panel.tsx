"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, LeadItem, LeadsResponse, UnansweredItem } from "@/app/lib/api";

export default function LeadsPanel() {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [unanswered, setUnanswered] = useState<UnansweredItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [teachingId, setTeachingId] = useState<number | null>(null);
  const [teachText, setTeachText] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api<LeadsResponse>("/api/leads");
      setLeads(data.leads || []);
      setUnanswered(data.unanswered || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load leads.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function replaceQuery(next: UnansweredItem) {
    setUnanswered((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
  }

  async function markAbuse(id: number) {
    setSavingId(id);
    try {
      replaceQuery(await api<UnansweredItem>(`/api/unanswered/${id}/abuse`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingId(null);
    }
  }

  async function markOutOfContext(id: number) {
    setSavingId(id);
    try {
      replaceQuery(
        await api<UnansweredItem>(`/api/unanswered/${id}/out-of-context`, {
          method: "POST",
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingId(null);
    }
  }

  async function teachAnswer(event: FormEvent, id: number) {
    event.preventDefault();
    if (!teachText.trim()) return;
    setSavingId(id);
    try {
      replaceQuery(
        await api<UnansweredItem>(`/api/unanswered/${id}/teach`, {
          method: "POST",
          body: JSON.stringify({ answer: teachText.trim() }),
        }),
      );
      setTeachingId(null);
      setTeachText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save answer.");
    } finally {
      setSavingId(null);
    }
  }

  function statusLabel(status: string) {
    if (status === "taught") return "Bot will use your answer next time";
    if (status === "abuse") return "Marked as abuse · bot will stay respectful";
    if (status === "out_of_context") return "Marked out of context";
    return "";
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Leads</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every chat saves a visitor lead. Name, email, and phone come from the
        customer website browser when those exist. Unanswered questions are
        listed separately below.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Loading leads...</p>
      ) : error ? (
        <p className="mt-8 text-sm text-red-600">{error}</p>
      ) : (
        <div className="mt-8 space-y-8">
          <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold">Visitor leads</h2>
            <p className="mt-1 text-xs text-slate-500">
              Collected on every chat, not only when the bot cannot answer.
            </p>
            {leads.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No leads yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs tracking-wide text-slate-500 uppercase">
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">Phone</th>
                      <th className="py-2 pr-3 font-medium">Page</th>
                      <th className="py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id} className="border-b border-stone-100">
                        <td className="py-2.5 pr-3">{lead.name || "—"}</td>
                        <td className="py-2.5 pr-3">{lead.email || "—"}</td>
                        <td className="py-2.5 pr-3">{lead.phone || "—"}</td>
                        <td className="max-w-[220px] truncate py-2.5 pr-3 text-slate-500" title={lead.extra?.page || ""}>
                          {lead.extra?.page || "—"}
                        </td>
                        <td className="py-2.5 text-slate-500">{lead.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold">Unanswered queries</h2>
            <p className="mt-1 text-xs text-slate-500">
              Teach an answer, mark abuse so the bot stays respectful, or mark
              the question out of context.
            </p>
            {unanswered.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No unanswered questions yet.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {unanswered.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-stone-200 bg-[#f6f4ef] p-4"
                  >
                    <p className="text-sm font-medium text-slate-900">
                      {item.question}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {item.customerName || item.customerEmail || "Visitor"}
                      {item.customerEmail ? ` · ${item.customerEmail}` : ""}
                      {item.customerPhone ? ` · ${item.customerPhone}` : ""}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      {item.createdAt.replace("T", " ").slice(0, 19)}
                    </p>

                    {item.status && item.status !== "open" ? (
                      <p className="mt-3 text-xs font-medium text-emerald-800">
                        {statusLabel(item.status)}
                        {item.taughtAnswer ? ` · “${item.taughtAnswer}”` : ""}
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => {
                            setTeachingId(item.id);
                            setTeachText("");
                          }}
                          className="rounded-lg bg-[#163532] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          Teach answer
                        </button>
                        <button
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => markAbuse(item.id)}
                          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60"
                        >
                          Abuse
                        </button>
                        <button
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => markOutOfContext(item.id)}
                          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60"
                        >
                          Out of context
                        </button>
                      </div>
                    )}

                    {teachingId === item.id && item.status === "open" ? (
                      <form
                        onSubmit={(event) => teachAnswer(event, item.id)}
                        className="mt-3 space-y-2"
                      >
                        <textarea
                          value={teachText}
                          onChange={(event) => setTeachText(event.target.value)}
                          rows={3}
                          placeholder="Write the answer the bot should use next time"
                          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#163532]"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={savingId === item.id || !teachText.trim()}
                            className="rounded-lg bg-[#163532] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                          >
                            Save for bot
                          </button>
                          <button
                            type="button"
                            onClick={() => setTeachingId(null)}
                            className="rounded-lg px-3 py-1.5 text-xs text-slate-500"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
