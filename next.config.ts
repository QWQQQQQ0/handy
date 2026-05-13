import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: "export",
  assetPrefix: isProd ? './' : undefined,
  images: { unoptimized: true },
  devIndicators: false,
};

export default nextConfig;
