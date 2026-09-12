import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  devIndicators: false,
  serverExternalPackages: [
    'runtime',
    '@prisma/client',
    '@prisma/adapter-better-sqlite3',
    'better-sqlite3',
    'prisma',
  ],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  webpack(config, { isServer }) {
    if (isServer) {
      // Workspace symlinks resolve outside node_modules, so Next's package external
      // matcher misses them. Keep the compiled Node host intact (native SQLite,
      // import.meta.url and CLI migration paths), never bundle it into browser JS.
      config.externals = [
        ({ request }: { request?: string }, callback: (error?: Error | null, value?: string) => void) => {
          if (request === 'runtime/host') return callback(null, 'commonjs runtime/host');
          callback();
        },
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
      ];
    }
    return config;
  },
};
export default config;
