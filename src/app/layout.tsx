import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PM2 Process Manager Dashboard",
  description: "Secure, modern web dashboard to control PM2 processes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
