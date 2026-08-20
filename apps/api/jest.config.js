/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts', '**/*.spec.ts'],
  setupFiles: ['dotenv/config'],
  testTimeout: 30000,
  moduleNameMapper: {
    '^@campusos/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};
