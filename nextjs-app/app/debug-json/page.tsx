// Project owner: Levent Cetin
import { AppShell } from "@/components/AppShell";
import { JsonDebugClient } from "@/components/JsonDebugClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DebugJsonPage() {
  const session = await requireServerSession();
  return (
    <AppShell username={session.username}>
      <JsonDebugClient />
    </AppShell>
  );
}

