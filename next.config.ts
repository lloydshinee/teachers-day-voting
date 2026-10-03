import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "my.spc.edu.ph",
    "my.spc.edu.ph:3000",
    "192.168.1.8",
    "192.168.1.8:3000",
    "localhost:3000",
  ],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "my.spc.edu.ph:3000",
        "my.spc.edu.ph",
        "192.168.1.8:3000",
        "localhost:3000",
      ],
    },
  },
};

export default nextConfig;
