"use client";

import { useEffect, useState } from "react";
import { VisitorPayload } from "@/app/lib/api";
import ChatPanel from "@/app/components/chatbot/chat-panel";

export default function EmbedChat({ widgetKey }: { widgetKey: string }) {
  const [parentVisitor, setParentVisitor] = useState<VisitorPayload | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || event.data.type !== "aibot-visitor") return;
      setParentVisitor(event.data.visitor as VisitorPayload);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <main className="h-screen">
      <ChatPanel
        widgetKey={widgetKey}
        title="Support"
        subtitle="Ask, or try a product on your photo"
        welcome="Hi, I can help with products, stock, and support. Upload your photo and tap Try on me to see an item on you."
        placeholder="Ask a question, or attach a photo"
        visitorSource="widget"
        extraVisitor={parentVisitor}
        compact
      />
    </main>
  );
}
