import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // expose the API base URL to the client via NEXT_PUBLIC_API_BASE
  env: {
    // Default to the production Railway URL you provided; can be overridden locally via .env.local or environment variables
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? 'https://taxi-calculator-das-taxis-uk.up.railway.app/api'
  }
};

export default nextConfig;
