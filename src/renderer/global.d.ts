import type { KeyflareApi } from "../shared/keyflare-api";

declare global {
  interface Window {
    keyflare: KeyflareApi;
  }
}

export {};
