import type { Config } from 'jest';
import { pathsToModuleNameMapper } from 'ts-jest';
import ts from 'typescript';

// Path aliases (e.g. the ones added by `nest g library`) live in tsconfig.json,
// so they are read from there instead of being duplicated here.
const { config: tsconfig } = ts.readConfigFile(
  './tsconfig.json',
  ts.sys.readFile,
);
const paths = tsconfig?.compilerOptions?.paths ?? {};

// Phase A validation (2026-09-11): @nestjs/common (and the rest of the
// Nest v12 packages) ship as pure ESM — no CommonJS build at all
// (package.json: "type": "module", a single unconditional "." export).
// This repo's TS source is authored as plain ESM-style import/export
// already (no CJS globals), so the fix is to have ts-jest emit real ESM
// for Jest's VM-modules loader instead of its default CJS-interop output,
// rather than touching NestJS versions or adding new dependencies. The
// `module`/`moduleResolution` override below applies ONLY inside this
// jest transform — apps/api/tsconfig.json (used by `tsc` and `nest
// build`) is untouched, so this doesn't change what actually ships.
//
// Running tests still requires the `--experimental-vm-modules` Node flag
// (see package.json's "test" script) — Jest doesn't yet use Node's native
// require(esm) transparently on this Node version.
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: { module: 'esnext', moduleResolution: 'bundler' },
      },
    ],
  },
  moduleNameMapper: pathsToModuleNameMapper(paths, { prefix: '<rootDir>/' }),
  setupFiles: ['<rootDir>/src/test-setup-env.ts'],
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'libs/**/*.(t|j)s',
    'apps/**/*.(t|j)s',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
