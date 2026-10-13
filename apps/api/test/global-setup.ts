import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Creates a fresh SQLite test database by applying the real migrations, so
 * integration tests exercise the same schema production uses.
 * Set TEST_DATABASE_URL to a mysql:// URL with a fresh database name to run the suite against MySQL.
 */
export default function setup() {
  const mysqlUrl = process.env.TEST_DATABASE_URL;
  if (mysqlUrl?.startsWith('mysql://')) {
    // Non-destructive: point TEST_DATABASE_URL at a NEW, empty database name for each run;
    // `migrate deploy` creates it and applies the real MySQL migrations. Nothing is reset.
    execSync('npm run prisma:schema:mysql', { cwd: repoRoot, stdio: 'pipe' });
    execSync('npx prisma migrate deploy --schema prisma/mysql/schema.prisma', {
      cwd: repoRoot,
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: mysqlUrl },
    });
    process.env.DATABASE_URL = mysqlUrl;
    return;
  }

  const dbFile = path.join(repoRoot, 'prisma', 'test.db');
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    fs.rmSync(dbFile + suffix, { force: true });
  const url = 'file:./test.db?connection_limit=1';
  execSync('npx prisma migrate deploy', {
    cwd: repoRoot,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
  process.env.DATABASE_URL = url;
}
