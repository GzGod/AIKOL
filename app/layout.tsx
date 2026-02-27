import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIKOL Ops Hub",
  description: "Multi-account X publishing and management hub"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
