import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
