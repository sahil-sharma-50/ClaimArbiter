import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      // Legacy dashboard paths; keep old links working.
      // `:path*` (zero or more) also matches the bare prefix.
      { source: "/console/:path*", destination: "/app/:path*", permanent: true },
      { source: "/classic/:path*", destination: "/app/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
