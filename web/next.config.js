/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/branch-visit";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  basePath: basePath === "/" ? "" : basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath === "/" ? "" : basePath,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || `${basePath === "/" ? "" : basePath}/api/v1`,
  },
  async rewrites() {
    // backend DNS name + container port (compose network). Inside the network
    // the backend listens on 8000.
    return [
      {
        source: "/api/v1/:path*",
        destination: "http://backend:8000/api/v1/:path*",
      },
      {
        // Reference sample evidence (PDFs) served by the backend under /static.
        source: "/static/:path*",
        destination: "http://backend:8000/static/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https: http:",
              "font-src 'self' data:",
              // All API traffic is same-origin via the /api/v1 proxy.
              "connect-src 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
