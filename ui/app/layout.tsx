import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Engram",
  description: "Your memory, on your machine.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
