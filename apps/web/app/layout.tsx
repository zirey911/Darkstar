import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Darkstar",
  description: "Darkstar — an educational AI guide to Martian survival.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
