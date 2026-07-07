/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native/node-API packages must not be bundled by Turbopack —
  // sqlite-vec resolves its .so extension via import.meta at runtime.
  serverExternalPackages: ["better-sqlite3", "sqlite-vec"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
