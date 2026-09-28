"use client";

import { useState } from "react";
import TryChat from "@/app/components/chatbot/try-chat";
import { useDashboard } from "@/app/components/dashboard/dashboard-shell";

export default function ChatbotPanel() {
  const { user } = useDashboard();
  const [copied, setCopied] = useState(false);

  async function copyEmbed() {
    await navigator.clipboard.writeText(user.embedCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-8">
      <header className="overflow-hidden rounded-[28px] border border-[#163532]/10 bg-[linear-gradient(135deg,#163532_0%,#1f4a45_58%,#2a5f58_100%)] px-6 py-7 text-[#f6f4ef] shadow-[0_24px_60px_rgba(22,53,50,0.18)] md:px-8">
        <p className="text-[11px] font-semibold tracking-[0.22em] text-[#9db5af] uppercase">
          Live widget
        </p>
        <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Chatbot</h1>
            <p className="mt-2 text-sm leading-6 text-[#c5d4d0]">
              Preview answers, copy the embed, and publish the same assistant
              your customers will see on your site.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill label="Widget live" />
            <StatusPill label="Leads captured" muted />
            <StatusPill label="Voice ready" muted />
          </div>
        </div>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StepCard
              step="01"
              title="Preview"
              copy="Test replies, products, and voice in the live preview."
            />
            <StepCard
              step="02"
              title="Embed"
              copy="Copy the script and paste it before the closing body tag."
            />
            <StepCard
              step="03"
              title="Collect"
              copy="Every chat is stored as a lead when the browser has contact data."
            />
          </div>

          <section className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-[0_16px_40px_rgba(22,53,50,0.06)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-6 py-5">
              <div>
                <h2 className="text-base font-semibold text-[#163532]">Install on your website</h2>
                <p className="mt-1 text-sm text-slate-500">
                  One script. Same chatbot as this preview.
                </p>
              </div>
              <button
                type="button"
                onClick={copyEmbed}
                className="inline-flex items-center gap-2 rounded-full bg-[#163532] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#102825]"
              >
                <CopyIcon />
                {copied ? "Copied" : "Copy code"}
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-[#163532]/8 px-3 py-1 font-medium text-[#163532]">
                  Widget key
                </span>
                <code className="rounded-lg bg-[#f6f4ef] px-2.5 py-1 font-mono text-[12px] text-slate-700">
                  {user.widgetKey}
                </code>
              </div>

              <div className="overflow-hidden rounded-2xl bg-[#0f2421] ring-1 ring-black/10">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                  </div>
                  <p className="text-[11px] tracking-wide text-white/40 uppercase">embed.js</p>
                </div>
                <pre className="overflow-x-auto p-4 text-[12px] leading-7 text-[#d7e4e0]">
                  {user.embedCode}
                </pre>
              </div>

              <p className="text-xs leading-5 text-slate-500">
                Unanswered questions stay under Leads. Voice and try-on use the
                same settings as this dashboard preview.
              </p>
            </div>
          </section>
        </div>

        <aside className="xl:sticky xl:top-2">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-[#163532]/55 uppercase">
                Customer view
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[#163532]">Try the chatbot</h2>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100">
              Preview
            </span>
          </div>
          <div className="rounded-[32px] bg-[#163532] p-2 shadow-[0_28px_70px_rgba(22,53,50,0.22)]">
            <div className="h-[36rem] overflow-hidden rounded-[26px] bg-[#f6f4ef]">
              <TryChat user={user} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium ${
        muted ? "bg-white/8 text-[#c5d4d0]" : "bg-white/15 text-white"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${muted ? "bg-[#9db5af]" : "bg-emerald-400"}`} />
      {label}
    </span>
  );
}

function StepCard({ step, title, copy }: { step: string; title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-[#163532]/45">{step}</p>
      <p className="mt-2 text-sm font-semibold text-[#163532]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{copy}</p>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="8" y="8" width="11" height="12" rx="2" />
      <path d="M5 16V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}
