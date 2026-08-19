/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  images: {
    formats: ["image/avif", "image/webp"]
  }
};

export default nextConfig;
