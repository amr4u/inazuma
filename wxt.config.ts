import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Decision Formfill',
    description: 'Decision-driven form filling with local encrypted profiles.',
    version: '0.1.0',
    permissions: ['storage', 'tabs', '<all_urls>', 'https://api.cloudflare.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'decision-formfill@local.example',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['websiteContent', 'browsingActivity', 'authenticationInfo'],
        },
      },
      gecko_android: { strict_min_version: '142.0' },
    },
  },
});
