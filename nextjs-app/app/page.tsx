// Project owner: Levent Cetin
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<never> {
  const session = await getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  redirect("/login");
}
