import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CV Tailoring API",
  description: "API-only backend for tailored CV generation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
