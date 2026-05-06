/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Receipt photos can run 2–4 MB after compression.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
