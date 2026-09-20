import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * Node MSW server for frontend tests only. This is not a standalone mock API
 * server: it intercepts fetch inside Vitest. No service worker is registered.
 */
export const server = setupServer(...handlers);
