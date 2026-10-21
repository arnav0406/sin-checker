import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['storage'],
    host_permissions: ['http://localhost:8787/*'],
  },
});

