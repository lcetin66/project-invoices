// Project owner: Levent Cetin
import { redirect } from "next/navigation";
import { LanguageProvider } from "@/components/LanguageProvider";
import { LoginForm } from "@/components/LoginForm";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="login-page">
      <LanguageProvider>
        <LoginForm />
      </LanguageProvider>
    </div>
  );
}
