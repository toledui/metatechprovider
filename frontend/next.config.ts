import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "localhost,127.0.0.1,172.31.160.1,mi-unmorose-unimportunately.ngrok-free.dev")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins,
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:3001";

    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
