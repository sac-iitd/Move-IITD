/**
 * Generates prisma/mysql/schema.prisma from prisma/schema.prisma.
 *  - swaps the datasource provider to "mysql"
 *  - turns `// @mysql <attrs>` trailing comments into native type attributes
 * Run: npm run prisma:schema:mysql
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'prisma', 'schema.prisma');
const outDir = path.join(root, 'prisma', 'mysql');
const out = path.join(outDir, 'schema.prisma');

export function toMysqlSchema(schema: string): string {
  const normalized = schema.replace(/\r\n/g, '\n');
  let swapped = normalized.replace(/provider\s*=\s*"sqlite"/, 'provider = "mysql"');
  if (swapped === normalized) throw new Error('Could not find the sqlite provider line');
  swapped = swapped
    .split('\n')
    .map((line) => {
      const m = /^(.*?)\s*\/\/\s*@mysql\s+(.+)$/.exec(line);
      return m ? `${m[1]} ${m[2]!.trim()}` : line;
    })
    .join('\n');
  const header =
    '// GENERATED FILE — do not edit. Source: prisma/schema.prisma (npm run prisma:schema:mysql)\n';
  return header + swapped;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, toMysqlSchema(fs.readFileSync(src, 'utf8')));
  console.log(`Wrote ${path.relative(root, out)}`);
}
