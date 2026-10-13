/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public. Path or URL of the API, default "/api/v1". Never put secrets in VITE_ variables. */
  readonly VITE_API_BASE?: string;
}
