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
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "MonFrench — Votre espace de français, simplement." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "MonFrench",
      description: "Château de verre — votre espace de français, simplement.",
      images: ["/og.png"],
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
