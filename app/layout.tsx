import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIKOL 运营中枢",
  description: "多账号 X 发布与管理中枢"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
