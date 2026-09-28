import EmbedChat from "@/app/components/embed/embed-chat";

type EmbedPageProps = {
  params: Promise<{ widgetKey: string }>;
};

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { widgetKey } = await params;
  return <EmbedChat widgetKey={widgetKey} />;
}
