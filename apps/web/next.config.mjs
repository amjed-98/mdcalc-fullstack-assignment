/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mdcalc/shared', '@mdcalc/ui'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
