import { AppShell } from "@/components/AppShell";
import { ImageEditorClient } from "@/components/ImageEditorClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  const session = await requireServerSession();

  return (
    <AppShell
      username={session.username}
      title="Resim editörü"
      subtitle="Görseli döndürün, köşeleri yakalayın ve trapez çekimleri dikdörtgene düzeltin."
      pageClassName="image-editor-page"
    >
      <ImageEditorClient />
    </AppShell>
  );
}
