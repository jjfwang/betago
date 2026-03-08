/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Rewrites API calls to the backend server during development.
   * In production, configure a reverse proxy (e.g., nginx) to route
   * /api/* requests to the backend service.
   */
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
