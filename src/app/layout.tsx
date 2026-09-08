import Analytics from "@/components/Analytics";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://scooters.plhery.com"),
  title: "Scooters",
  description: "Find shared e-scooters in Switzerland and selected cities in France, Germany and Italy",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Scooters",
    title: "Scooters",
    description: "Find shared e-scooters in Switzerland and selected cities in France, Germany and Italy",
    locale: "en_CH",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Scooters" }],
  },
  twitter: {
    card: "summary",
    title: "Scooters",
    description: "Find shared e-scooters in Switzerland and selected cities in France, Germany and Italy",
    images: ["/icon-512.png"],
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Scooters",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-CH" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />
        <meta name="theme-color" content="#e0ddd8" />
      </head>
      <body className={geistSans.variable}>
        <I18nProvider>{children}</I18nProvider>
        <ServiceWorkerRegistration />
        <Analytics />
      </body>
    </html>
  );
}
