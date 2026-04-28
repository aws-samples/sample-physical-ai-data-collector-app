/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  readonly VITE_USER_POOL_DOMAIN: string;
  readonly VITE_OAUTH_REDIRECT_URI: string;
  readonly VITE_REGION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
