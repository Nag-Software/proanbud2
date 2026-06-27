import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mammoth", "pdf-parse", "puppeteer-core", "@sparticuz/chromium"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.tripletex.no"
      },
      {
        protocol: "https",
        hostname: "fiken.no"
      },
      {
        protocol: "https",
        hostname: "brandlogos.net"
      },
      {
        protocol: "https",
        hostname: "companieslogo.com" 
      }
    ]
  }
};

export default nextConfig;
