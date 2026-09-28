"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  API_URL,
  api,
  canTryOnProduct,
  CatalogProduct,
  Stats,
  VisitorPayload,
  productImageSrc,
} from "@/app/lib/api";
import { collectVisitorFromStorage, mergeVisitors } from "@/app/lib/visitor";
import ProductCards from "@/app/components/chatbot/product-cards";
import TypingIndicator from "@/app/components/chatbot/typing-indicator";

type ChatItem = {
  sender: "customer" | "ai";
  text: string;
  photoUrl?: string;
  generatedImage?: string;
  products?: CatalogProduct[];
};

function fileToBase64(file: File) {
  return new Promise<{ base64: string; mime: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",", 2)[1] : result;
      resolve({ base64, mime: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
}

export default function ChatPanel({
  widgetKey,
  title,
  subtitle,
  welcome,
  placeholder,
  visitorSource,
  extraVisitor,
  onStats,
  compact,
}: {
  widgetKey: string;
  title: string;
  subtitle: string;
  welcome: string;
  placeholder: string;
  visitorSource: string;
  extraVisitor?: VisitorPayload | null;
  onStats?: (stats: Stats) => void;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([
    { sender: "ai", text: welcome },
  ]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [pendingProduct, setPendingProduct] = useState<CatalogProduct | null>(null);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const voiceOnRef = useRef(voiceOn);
  const voiceReadyRef = useRef(voiceReady);
  const pendingSpeakRef = useRef(false);

  useEffect(() => {
    const box = messagesRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  useEffect(() => {
    fetch(`${API_URL}/api/widget/voice?widgetKey=${encodeURIComponent(widgetKey)}`)
      .then((response) => response.json())
      .then((data) => setVoiceReady(Boolean(data.voiceReady)))
      .catch(() => setVoiceReady(false));
  }, [widgetKey]);

  useEffect(() => {
    voiceOnRef.current = voiceOn;
    voiceReadyRef.current = voiceReady;
    if (!voiceOn) {
      audioRef.current?.pause();
      setSpeaking(false);
      return;
    }
    if (!voiceReady || !pendingSpeakRef.current) return;
    pendingSpeakRef.current = false;
    const lastAi = [...messages]
      .reverse()
      .find((item) => item.sender === "ai" && item.text.trim() && item.text !== welcome);
    if (lastAi) void speakReply(lastAi.text);
  }, [voiceOn, voiceReady, messages, welcome]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  async function speakReply(text: string) {
    if (!voiceOnRef.current || !voiceReadyRef.current || !text.trim()) return;
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    try {
      const response = await fetch(`${API_URL}/api/widget/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetKey, text }),
      });
      if (!response.ok || !voiceOnRef.current) return;
      const url = URL.createObjectURL(await response.blob());
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeaking(true);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      if (!voiceOnRef.current) {
        setSpeaking(false);
        return;
      }
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }

  function toggleVoice() {
    setVoiceOn((current) => {
      const next = !current;
      if (next) pendingSpeakRef.current = true;
      return next;
    });
  }

  function choosePhoto(file: File | null) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : "");
  }

  function requestTryOn(product: CatalogProduct) {
    if (!canTryOnProduct(product)) return;
    setPendingProduct(product);
    fileRef.current?.click();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    const question =
      text.trim() ||
      (photo
        ? pendingProduct
          ? `Try ${pendingProduct.name} on me`
          : "Try this on me"
        : "");
    if (!question) return;

    const localPhoto = photoPreview;
    setText("");
    setSending(true);
    setMessages((current) => [
      ...current,
      { sender: "customer", text: question, photoUrl: localPhoto },
    ]);

    try {
      const photoPayload = photo ? await fileToBase64(photo) : null;
      const result = await api<{
        conversationId: number;
        reply: string;
        products?: CatalogProduct[];
        generatedImage?: string;
      }>("/api/widget/message", {
        method: "POST",
        body: JSON.stringify({
          widgetKey,
          conversationId,
          text: question,
          productId: pendingProduct?.id || null,
          photoBase64: photoPayload?.base64 || "",
          photoMime: photoPayload?.mime || "image/jpeg",
          visitor: mergeVisitors(
            extraVisitor,
            collectVisitorFromStorage(visitorSource),
          ),
        }),
      });
      setConversationId(result.conversationId);
      setMessages((current) => [
        ...current,
        {
          sender: "ai",
          text: result.reply,
          products: result.products,
          generatedImage: result.generatedImage,
        },
      ]);
      void speakReply(result.reply);
      choosePhoto(null);
      setPendingProduct(null);
      if (onStats) {
        try {
          onStats(await api<Stats>("/api/stats"));
        } catch {
          // Chat already succeeded.
        }
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          sender: "ai",
          text: error instanceof Error ? error.message : "Chat is unavailable.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={
        compact
          ? "flex h-screen max-h-screen flex-col overflow-hidden bg-[#f4f1ea] text-slate-900"
          : "flex h-[36rem] max-h-[36rem] flex-col overflow-hidden bg-[#f4f1ea]"
      }
    >
      <div className="flex items-center gap-3 bg-[linear-gradient(180deg,#1a3d39_0%,#163532_100%)] px-4 py-3.5 text-[#f6f4ef] md:px-5">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 text-sm font-semibold shadow-inner">
          {title.slice(0, 1).toUpperCase()}
          <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#163532] bg-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#9db5af]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleVoice}
          disabled={!voiceReady}
          aria-label={
            voiceReady
              ? voiceOn
                ? "Voice is on"
                : "Voice is off"
              : "Add your voice in Chatbot settings first"
          }
          title={
            voiceReady
              ? voiceOn
                ? speaking
                  ? "Speaking"
                  : "Voice is on"
                : "Voice is off"
              : "Add your voice in Chatbot settings first"
          }
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
            !voiceReady
              ? "cursor-not-allowed bg-white/10 text-white/35"
              : voiceOn
                ? "bg-emerald-500 text-white shadow-[0_6px_16px_rgba(16,185,129,0.35)]"
                : "bg-red-500 text-white shadow-[0_6px_16px_rgba(239,68,68,0.35)]"
          }`}
        >
          {voiceOn ? (
            <SpeakerIcon speaking={speaking} />
          ) : (
            <MutedSpeakerIcon />
          )}
        </button>
      </div>

      <div
        ref={messagesRef}
        className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5"
      >
        {messages.map((message, index) => (
          <div
            key={`${message.sender}-${index}`}
            className={`max-w-[85%] ${message.sender === "customer" ? "ml-auto" : ""}`}
          >
            <div
              className={`rounded-[22px] px-3.5 py-2.5 text-[13px] leading-6 whitespace-pre-wrap ${
                message.sender === "customer"
                  ? "rounded-br-md bg-[#163532] text-white shadow-[0_8px_20px_rgba(22,53,50,0.18)]"
                  : "rounded-bl-md border border-white/80 bg-white text-slate-800 shadow-[0_8px_22px_rgba(22,53,50,0.06)]"
              }`}
            >
              {message.text}
              {message.photoUrl ? (
                <img
                  src={message.photoUrl}
                  alt=""
                  className="mt-2 max-h-40 rounded-xl object-cover"
                />
              ) : null}
              {message.generatedImage ? (
                <img
                  src={productImageSrc(message.generatedImage)}
                  alt="Try-on preview"
                  className="mt-2 max-h-72 rounded-xl object-contain"
                />
              ) : null}
            </div>
            {message.sender === "ai" ? (
              <ProductCards products={message.products} onTryOn={requestTryOn} />
            ) : null}
          </div>
        ))}
        {sending ? <TypingIndicator /> : null}
      </div>

      {pendingProduct || photoPreview ? (
        <div className="flex items-center gap-2 border-t border-[#163532]/8 bg-white/70 px-4 py-2.5 text-xs text-slate-600">
          {photoPreview ? (
            <img src={photoPreview} alt="" className="h-10 w-10 rounded-md object-cover" />
          ) : null}
          <span className="flex-1">
            {pendingProduct
              ? `Trying on ${pendingProduct.name}. Upload your photo, then send.`
              : "Photo attached. Name the product or send to try it on."}
          </span>
          <button
            type="button"
            onClick={() => {
              choosePhoto(null);
              setPendingProduct(null);
            }}
            className="text-[#163532]"
          >
            Clear
          </button>
        </div>
      ) : null}

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-[#163532]/8 bg-white p-3"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => choosePhoto(event.target.files?.[0] || null)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-[#f6f4ef] text-[#163532] transition hover:border-[#163532]/30"
          aria-label="Attach photo"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 16l4.5-4.5a2 2 0 0 1 2.8 0L16 16" />
            <path d="M14 14l1.5-1.5a2 2 0 0 1 2.8 0L21 16" />
            <rect x="3" y="5" width="18" height="14" rx="3" />
          </svg>
        </button>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-full border border-stone-200 bg-[#f6f4ef] px-4 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#163532] focus:bg-white"
        />
        <button
          type="submit"
          disabled={sending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#163532] text-white transition hover:bg-[#102825] disabled:opacity-60"
          aria-label="Send"
        >
          {sending ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M5 12h12M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}

function SpeakerIcon({ speaking }: { speaking?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M4.5 9.5h3.1L12 5.8v12.4l-4.4-3.7H4.5a1.2 1.2 0 0 1-1.2-1.2v-2.6c0-.7.5-1.2 1.2-1.2Z" />
      <path
        d="M16.2 8.4a4.6 4.6 0 0 1 0 7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className={speaking ? "origin-left animate-pulse" : ""}
      />
      <path
        d="M18.6 6.2a7.4 7.4 0 0 1 0 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        className={speaking ? "origin-left animate-pulse" : ""}
      />
    </svg>
  );
}

function MutedSpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M4.5 9.5h3.1L12 5.8v12.4l-4.4-3.7H4.5a1.2 1.2 0 0 1-1.2-1.2v-2.6c0-.7.5-1.2 1.2-1.2Z" />
      <path
        d="M15.4 9.2 20 13.8M20 9.2l-4.6 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}
