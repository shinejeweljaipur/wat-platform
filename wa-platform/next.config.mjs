/** @type {import('next').NextConfig} */
export default {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['pg'],
  },
};
