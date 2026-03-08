/**
 * Root layout for the BetaGo Next.js app.
 *
 * Sets the HTML language attribute, loads global styles, and provides the
 * minimal shell that every page inherits.  No client-side providers are
 * needed at this level because Zustand stores are module-level singletons
 * that work without a React context wrapper.
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BetaGo – Human vs AI Go",
  description:
    "Play a game of Go against an AI opponent. 9×9 board, Chinese area scoring, positional superko.",
  viewport: "width=device-width, initial-scale=1",
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
