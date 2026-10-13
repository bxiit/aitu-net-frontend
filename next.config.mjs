/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        missingSuspenseWithCSRBailout: false,
    },
    // Dev: proxy the backend through the Next server so the browser sees one origin
    // and the jwt cookie is stored for it (a cross-site cookie would need HTTPS).
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
