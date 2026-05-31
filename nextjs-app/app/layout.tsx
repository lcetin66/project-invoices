// Project owner: Levent Cetin
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/app/globals.css";
import { t } from "@/lang";

export const metadata: Metadata = {
  title: t.app.name,
  description: t.dashboard.uploadGreeting.replace("{username}", t.login.standard)
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
