export default function TypingIndicator() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl border border-white/80 bg-white px-3.5 py-2.5 shadow-[0_8px_22px_rgba(22,53,50,0.06)]">
      <span className="sr-only">Waiting for reply</span>
      <span className="h-1.5 w-1.5 rounded-full bg-[#163532] animate-bounce [animation-delay:-0.32s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-[#163532] animate-bounce [animation-delay:-0.16s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-[#163532] animate-bounce" />
    </div>
  );
}
