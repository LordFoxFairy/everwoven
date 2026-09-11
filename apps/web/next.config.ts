import type {NextConfig} from 'next';
import path from 'node:path';
const config: NextConfig = {devIndicators: false, output: 'standalone', outputFileTracingRoot: path.join(__dirname, '../..')};
export default config;
