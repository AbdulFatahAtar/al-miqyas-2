import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import type { Metadata } from "next";
import { ThemeProvider } from "../components/theme-provider";
import { themeBootstrapScript } from "../lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "منظومة المقياس",
  description: "منظومة قياس أثر التدريب وإثبات الإتقان",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          id="miqyas-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
