"use client";

import { FormEvent, useState } from "react";
import { api, AuthUser } from "@/app/lib/api";

type OnboardingModalProps = {
  onComplete: (user: AuthUser) => void;
  onSkip: () => void;
};

export default function OnboardingModal({
  onComplete,
  onSkip,
}: OnboardingModalProps) {
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim() && !website.trim() && !pdf) {
      setError("Add a business description, website, or PDF.");
      return;
    }

    setError("");
    setSaving(true);
    try {
      const form = new FormData();
      form.append("businessDescription", description);
      form.append("websiteUrl", website);
      if (pdf) form.append("pdf", pdf);
      const user = await api<AuthUser>("/api/onboarding", {
        method: "POST",
        body: form,
      });
      onComplete(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not train the chatbot.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#163532]/50 px-4 py-8">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-xs font-semibold tracking-[0.18em] text-[#163532] uppercase">
          Train your chatbot
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Tell us about your business</h2>
        <p className="mt-2 text-sm text-slate-500">
          We will use this to teach the AI your services, pages, and important
          details. You can update it later from Chatbot settings.
        </p>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">
              Business description
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              placeholder="We sell handmade bags, deliver in 2 days, and offer 7-day refunds..."
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-[#163532] focus:ring-2 focus:ring-[#163532]/15"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">Upload PDF</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setPdf(event.target.files?.[0] || null)}
              className="w-full rounded-lg border border-dashed border-stone-300 px-3 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#163532] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
            />
            <span className="mt-2 block text-xs text-slate-500">
              Brochure, price list, or FAQ. We extract the text for the chatbot.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">Website domain</span>
            <input
              type="text"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="www.yourbusiness.com"
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-[#163532] focus:ring-2 focus:ring-[#163532]/15"
            />
            <span className="mt-2 block text-xs text-slate-500">
              We will read pages on this site and teach the chatbot your
              services.
            </span>
          </label>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#163532] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Reading your content..." : "Teach my chatbot"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
