/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      new Date().toISOString().replace(/[-:TZ:.]/g, '').slice(0, 12),
  },
};
export default nextConfig;
