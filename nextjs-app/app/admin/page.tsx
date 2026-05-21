import { AppShell } from "@/components/AppShell";
import { AdminClient } from "@/components/AdminClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireServerSession();

  return (
    <AppShell username={session.username}>
      <AdminClient />
    </AppShell>
  );
}
