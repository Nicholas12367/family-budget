import type { Metadata } from "next";

// Owner-only dashboard layout. Overrides the manifest so when the owner
// taps "Add to Home Screen" while inside this section, the resulting app
// icon opens directly to the admin dashboard instead of the budget app.
// Orange icon variant so admin stands out from the budget app on the
// iPhone home screen.
export const metadata: Metadata = {
  title: "Budget Admin",
  manifest: "/manifest-admin.json",
  appleWebApp: {
    capable: true,
    title: "Budget Admin",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-admin-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-admin-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon-admin.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function AdminSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
