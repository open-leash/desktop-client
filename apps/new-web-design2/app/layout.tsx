import type { Metadata } from "next";
import { Poly } from "next/font/google";
import "./globals.css";

const poly = Poly({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-poly"
});

export const metadata: Metadata = {
  title: "Leash | The Antivirus for AI",
  description:
    "Leash blocks destructive commands, masks sensitive data, and asks before risky AI-agent actions run.",
  icons: {
    icon: "/media/leash-mark.webp",
    shortcut: "/media/leash-mark.webp",
    apple: "/media/leash-mark.webp"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Akt:wght@100..900&display=swap"
        />
      </head>
      <body className={poly.variable}>{children}</body>
    </html>
  );
}
