"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function DemoLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "admin123" })
        });
      } finally {
        if (!cancelled) {
          router.replace(searchParams.get("next") || "/dashboard");
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif" }}>
      Demo session is being prepared...
    </main>
  );
}
