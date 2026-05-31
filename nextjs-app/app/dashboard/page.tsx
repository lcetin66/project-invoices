// Project owner: Levent Cetin
import { AppShell } from "@/components/AppShell";
import { DashboardStatsClient } from "@/components/DashboardStatsClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireServerSession();

  return (
    <AppShell username={session.username}>
      <DashboardStatsClient />
    </AppShell>
  );
}
