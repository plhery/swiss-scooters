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
  metadataBase: new URL("https://swiss-scooters.plhery.com"),
  title: "Swiss Scooters",
  description: "Find nearby shared e-scooters across Switzerland",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Swiss Scooters",
    title: "Swiss Scooters",
    description: "Find nearby shared e-scooters across Switzerland",
    locale: "en_CH",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Swiss Scooters" }],
  },
  twitter: {
    card: "summary",
    title: "Swiss Scooters",
    description: "Find nearby shared e-scooters across Switzerland",
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
    title: "Swiss Scooters",
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
      </body>
    </html>
  );
}
