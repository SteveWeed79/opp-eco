import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Opportunity Ecosystem — Kansas Workforce Initiative",
  description:
    "Connecting Kansas students, employers, colleges, and workforce boards around paid internships that earn academic credit.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
