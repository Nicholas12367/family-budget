/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Receipt photos can run 2–4 MB after compression.
      bodySizeLimit: "8mb",
    },
  },
  // Defense-in-depth headers. Vercel serves everything over HTTPS already,
  // but these lock down clickjacking, MIME sniffing, referrer leakage, and
  // powerful-feature abuse in the browser. Kept intentionally minimal —
  // no CSP nonce work here since the app has no third-party embeds.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Camera is required for the receipt scanner. Everything else
            // stays off so a compromised script can't silently ask.
            value: "camera=(self), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
