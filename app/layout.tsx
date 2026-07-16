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
    title: "MonFrench — Château de verre",
    description: "Un espace privé et simple pour apprendre, assigner et corriger des activités de français.",
    openGraph: {
      title: "MonFrench",
      description: "Château de verre — votre espace de français, simplement.",
      type: "website",
      locale: "fr_CA",
    },
    twitter: {
      card: "summary",
      title: "MonFrench",
      description: "Château de verre — votre espace de français, simplement.",
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
