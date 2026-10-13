/**
 * Runs the API integration suite (including concurrency tests) against MySQL.
 *
 *   MYSQL_TEST_URL="mysql://user:pass@127.0.0.1:3306" npm run test:mysql
 *
 * A new database named iitd_bus_test_<timestamp> is created by `prisma migrate
 * deploy` (non-destructive; nothing existing is reset). The Prisma client is
 * generated for MySQL for the run and regenerated for SQLite afterwards.
 * The MySQL user needs CREATE privilege on the new database.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const base = process.env.MYSQL_TEST_URL?.replace(/\/+$/, '');
if (!base?.startsWith('mysql://')) {
  console.error('Set MYSQL_TEST_URL, e.g. mysql://user:pass@127.0.0.1:3306 (no database name).');
  process.exit(1);
}
const url = `${base}/iitd_bus_test_${Date.now()}`;
const run = (cmd: string, env: NodeJS.ProcessEnv = process.env) =>
  execSync(cmd, { stdio: 'inherit', env });

let failed = false;
try {
  run('npm run prisma:generate:mysql');
  run('npm test -w @iitd-bus/api', { ...process.env, TEST_DATABASE_URL: url });
} catch {
  failed = true;
} finally {
  // Always switch the generated client back to SQLite for local development, and verify it.
  try {
    run('npx prisma generate');
  } catch {
    /* checked below */
  }
  const generated = fs.readFileSync('node_modules/.prisma/client/schema.prisma', 'utf8');
  if (!/provider\s*=\s*"sqlite"/.test(generated)) {
    console.error(
      '\nWARNING: the Prisma client is still generated for MySQL. Stop any running dev server, then run: npx prisma generate',
    );
    failed = true;
  }
}
console.log(`\nMySQL test database used: ${url.replace(/\/\/[^@]*@/, '//***@')}`);
process.exit(failed ? 1 : 0);
