import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pm2", "pg", "mongodb"],
};

export default nextConfig;
