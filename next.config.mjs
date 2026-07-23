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
  webpack: (config, { webpack, nextRuntime }) => {
    // Edge instrumentation compile must not follow instrumentation.node → node:crypto/fs.
    if (nextRuntime === "edge") {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /instrumentation\.node/,
        })
      );
    }
    return config;
  },
};

export default nextConfig;
