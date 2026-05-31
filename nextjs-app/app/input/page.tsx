// Project owner: Levent Cetin
import { AppShell } from "@/components/AppShell";
import { DashboardClient } from "@/components/DashboardClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function InputPage() {
  const session = await requireServerSession();

  return (
    <AppShell username={session.username}>
      <DashboardClient username={session.username} />
    </AppShell>
  );
}
