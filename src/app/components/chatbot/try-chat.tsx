"use client";

import { AuthUser, Stats } from "@/app/lib/api";
import ChatPanel from "@/app/components/chatbot/chat-panel";

export default function TryChat({
  user,
  onStats,
}: {
  user: AuthUser;
  onStats?: (stats: Stats) => void;
}) {
  return (
    <ChatPanel
      widgetKey={user.widgetKey}
      title={`${user.companyName} support`}
      subtitle="Online · try products on your photo"
      welcome={`Hi, welcome to ${user.companyName}. Ask about products, or upload your photo and I can try an item on you.`}
      placeholder="Ask a question, or attach a photo to try on"
      visitorSource="preview"
      onStats={onStats}
    />
  );
}
