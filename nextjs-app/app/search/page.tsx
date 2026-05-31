// Project owner: Levent Cetin
import { AppShell } from "@/components/AppShell";
import { SearchClient } from "@/components/SearchClient";
import { requireServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const session = await requireServerSession();
  return (
    <AppShell username={session.username}>
      <SearchClient />
    </AppShell>
  );
}
