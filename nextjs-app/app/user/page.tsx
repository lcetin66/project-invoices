// Project owner: Levent Cetin
import { AppShell } from "@/components/AppShell";
import { UserClient } from "@/components/UserClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UserPage() {
  const session = await requireServerSession();
  return (
    <AppShell username={session.username}>
      <UserClient />
    </AppShell>
  );
}

