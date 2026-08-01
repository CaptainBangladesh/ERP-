/**
 * Backend test harness — seam 1: the HTTP boundary.
 *
 * Tests boot a real Nest application and drive it over HTTP against a real PostgreSQL
 * database. Nothing is mocked. `--runInBand` because tests share one database and reset it
 * between cases; parallel workers would race.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFilesAfterEnv: ['<rootDir>/test/harness/setup.ts'],
  testTimeout: 30000,
  clearMocks: true,
};
