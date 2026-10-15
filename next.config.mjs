/** @type {import('next').NextConfig} */
const nextConfig = {
    // Minimal self-contained server for the Docker image (see Dockerfile)
    output: "standalone",
    experimental: {
        missingSuspenseWithCSRBailout: false,
    },
    // Proxy the backend through the Next server so the browser sees one origin and the jwt
    // cookie is stored for it (a cross-site cookie would need HTTPS). Dev sets API_PROXY_TARGET
    // in .env.development; the Docker image sets it as a build arg (see Dockerfile).
    async rewrites() {
        const target = process.env.API_PROXY_TARGET;
        if (!target) {
            return [];
        }
        return [
            {source: "/api/:path*", destination: `${target}/api/:path*`},
            {source: "/ws/:path*", destination: `${target}/ws/:path*`},
        ];
    },
};

export default nextConfig;
