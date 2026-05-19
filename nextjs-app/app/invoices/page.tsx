import { AppShell } from "@/components/AppShell";
import { InvoicesClient } from "@/components/InvoicesClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await requireServerSession();

  return (
    <AppShell username={session.username}>
      <InvoicesClient />
    </AppShell>
  );
}
