import { setupServer } from 'msw/node';

/**
 * No default handlers. Each test declares the responses it depends on, so reading a test
 * tells you the whole scenario without hunting through shared fixtures.
 */
export const server = setupServer();
