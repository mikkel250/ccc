/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["ts", "tsx"],
  reactStrictMode: true,
  // instrumentation.ts dynamically imports OTEL/grpc — keep off the webpack graph
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@langfuse/otel",
    "@grpc/grpc-js",
  ],
};

export default nextConfig;
