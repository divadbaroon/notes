import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Papert Lab — Working Notes",
  description: "A densely-linked notes wiki for the Papert Lab discussion group.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
