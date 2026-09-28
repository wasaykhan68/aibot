"use client";

import Image from "next/image";
import background from "../../../../public/aibgbot.png";

export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-x-hidden overflow-y-auto text-slate-900">
      <Image
        src={background}
        alt=""
        fill
        priority
        unoptimized
        sizes="100vw"
        className="object-cover object-left"
      />
      <div className="absolute inset-0 bg-black/20 md:bg-gradient-to-r md:from-transparent md:via-black/10 md:to-black/50" />
      <div className="relative z-10 flex min-h-screen items-start justify-center px-4 py-12 md:items-center md:justify-end md:px-16 lg:px-24">
        {children}
      </div>
    </main>
  );
}
