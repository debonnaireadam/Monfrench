import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "monfrench.com";
  const protocol = host.includes("localhost") ? "http" : "https";
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "MonFrench — Connexion",
    description: "Espace privé.",
    robots: {
      index: false,
      follow: false,
      noarchive: true,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    },
    openGraph: {
      title: "MonFrench",
      description: "Espace privé.",
      type: "website",
      locale: "fr_CA",
    },
    twitter: {
      card: "summary",
      title: "MonFrench",
      description: "Espace privé.",
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
