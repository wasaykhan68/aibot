"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ChatbotSettingsData, api } from "@/app/lib/api";

const fieldClass =
  "w-full rounded-xl border border-stone-200 bg-[#faf9f6] px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#163532] focus:bg-white focus:ring-2 focus:ring-[#163532]/10";

export default function ChatbotSettings() {
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [voiceScript, setVoiceScript] = useState("");
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceCloned, setVoiceCloned] = useState(false);
  const [voiceConfigured, setVoiceConfigured] = useState(true);
  const [sample, setSample] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [saved, setSaved] = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function applySettings(data: ChatbotSettingsData) {
    setDescription(data.businessDescription || "");
    setWebsite(data.websiteUrl || "");
    setPdfName(data.pdfName || "");
    setVoiceScript(data.voiceScript || "");
    setVoiceReady(Boolean(data.voiceReady));
    setVoiceCloned(Boolean(data.voiceCloned));
    setVoiceConfigured(data.voiceConfigured !== false);
  }

  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      applySettings(await api<ChatbotSettingsData>("/api/chatbot/settings"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const form = new FormData();
      form.append("businessDescription", description);
      form.append("websiteUrl", website);
      form.append("voiceScript", voiceScript);
      if (pdf) form.append("pdf", pdf);
      applySettings(
        await api<ChatbotSettingsData>("/api/chatbot/settings", {
          method: "POST",
          body: form,
        }),
      );
      setPdf(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function startRecording() {
    setVoiceError("");
    setVoiceSaved(false);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      setSample(new File([blob], `voice-sample.${ext}`, { type: blob.type || "audio/webm" }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function handleCloneVoice() {
    if (!sample) {
      setVoiceError("Record or upload a voice sample first.");
      return;
    }
    setCloning(true);
    setVoiceError("");
    setVoiceSaved(false);
    try {
      const scriptForm = new FormData();
      scriptForm.append("businessDescription", description);
      scriptForm.append("websiteUrl", website);
      scriptForm.append("voiceScript", voiceScript);
      await api<ChatbotSettingsData>("/api/chatbot/settings", {
        method: "POST",
        body: scriptForm,
      });
      const form = new FormData();
      form.append("samples", sample);
      applySettings(
        await api<ChatbotSettingsData>("/api/chatbot/voice", {
          method: "POST",
          body: form,
        }),
      );
      setSample(null);
      setVoiceSaved(true);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Could not save that voice.");
    } finally {
      setCloning(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading chatbot settings...</p>;
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#163532]">Chatbot settings</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
          Update the knowledge your assistant uses. Changes apply after you save.
        </p>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <form
          onSubmit={handleSave}
          className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-[0_16px_40px_rgba(22,53,50,0.06)]"
        >
          <div className="border-b border-stone-100 px-6 py-5">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[#163532]/45 uppercase">
              Knowledge
            </p>
            <h2 className="mt-1 text-base font-semibold text-[#163532]">Business details</h2>
            <p className="mt-1 text-sm text-slate-500">
              Description, catalog source, and documents the bot can learn from.
            </p>
          </div>

          <div className="space-y-5 px-6 py-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[#163532]">
                Business description
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={6}
                placeholder="We sell handmade bags, deliver in 2 days, and offer 7-day refunds..."
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[#163532]">Website domain</span>
              <input
                type="text"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="www.yourbusiness.com"
                className={fieldClass}
              />
            </label>

            <div>
              <span className="mb-2 block text-sm font-medium text-[#163532]">Training PDF</span>
              <label className="flex cursor-pointer flex-col items-start gap-2 rounded-2xl border border-dashed border-stone-300 bg-[#faf9f6] px-4 py-4 transition hover:border-[#163532]/30 hover:bg-white">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#163532] px-3 py-1.5 text-xs font-medium text-white">
                  Choose PDF
                </span>
                <p className="text-xs text-slate-500">
                  {pdf
                    ? `Selected: ${pdf.name}`
                    : pdfName
                      ? `Current file: ${pdfName}`
                      : "No PDF uploaded yet. PDF only, up to 10MB."}
                </p>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => setPdf(event.target.files?.[0] || null)}
                />
              </label>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {saved ? <p className="text-sm text-emerald-700">Settings saved.</p> : null}

            <button
              type="submit"
              disabled={saving}
              className="rounded-full bg-[#163532] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#102825] disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-[24px] border border-stone-200 bg-white shadow-[0_16px_40px_rgba(22,53,50,0.06)]">
          <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-6 py-5">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-[#163532]/45 uppercase">
                Voice
              </p>
              <h2 className="mt-1 text-base font-semibold text-[#163532]">Your voice</h2>
              <p className="mt-1 text-sm text-slate-500">
                Chat already speaks with a default voice. Record this script only
                if you want answers in your own voice.
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                voiceCloned
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                  : "bg-[#163532]/6 text-[#163532] ring-1 ring-[#163532]/10"
              }`}
            >
              {voiceCloned ? "Cloned" : "Default"}
            </span>
          </div>

          <div className="space-y-5 px-6 py-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[#163532]">Script to read</span>
              <textarea
                value={voiceScript}
                onChange={(event) => setVoiceScript(event.target.value)}
                rows={6}
                className={fieldClass}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  recording
                    ? stopRecording()
                    : startRecording().catch((err) => {
                        setVoiceError(err instanceof Error ? err.message : "Microphone is blocked.");
                      })
                }
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  recording
                    ? "bg-red-600 text-white"
                    : "border border-stone-200 bg-[#faf9f6] text-[#163532] hover:border-[#163532]/25"
                }`}
              >
                {recording ? "Stop recording" : "Record script"}
              </button>
              <label className="cursor-pointer rounded-full border border-stone-200 bg-[#faf9f6] px-4 py-2 text-sm font-medium text-[#163532] transition hover:border-[#163532]/25">
                Upload audio
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.webm"
                  className="hidden"
                  onChange={(event) => {
                    setSample(event.target.files?.[0] || null);
                    setVoiceError("");
                    setVoiceSaved(false);
                  }}
                />
              </label>
            </div>

            <p className="text-xs leading-5 text-slate-500">
              {sample
                ? `Ready: ${sample.name}`
                : voiceCloned
                  ? "Your cloned voice is saved. Record again to replace it."
                  : voiceReady
                    ? "Voice is on in chat now. Record 20–60 seconds to use your own voice."
                    : "Use 20–60 seconds of clear speech, little background noise."}
            </p>

            {!voiceConfigured ? (
              <p className="text-sm text-amber-700">
                Add ELEVENLABS_API_KEY to backend/.env, then restart the API.
              </p>
            ) : null}
            {voiceError ? <p className="text-sm text-red-600">{voiceError}</p> : null}
            {voiceSaved ? (
              <p className="text-sm text-emerald-700">
                Voice saved. Turn Voice on in chat to hear answers.
              </p>
            ) : null}

            <button
              type="button"
              onClick={handleCloneVoice}
              disabled={cloning || !sample}
              className="rounded-full bg-[#163532] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#102825] disabled:opacity-60"
            >
              {cloning ? "Saving voice..." : "Give ElevenLabs this voice"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
