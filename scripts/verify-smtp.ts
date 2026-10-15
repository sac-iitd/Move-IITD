/**
 * Checks the configured email transport and optionally sends a test message.
 *   npm run email:verify                       # connect + authenticate only
 *   npm run email:verify -- --to you@iitd.ac.in
 */
import { loadEnv } from '../apps/api/src/config/env';
import { createMailer } from '../apps/api/src/email/mailer';

async function main() {
  const env = loadEnv();
  const mailer = createMailer(env);
  console.log(
    `Transport: ${env.EMAIL_TRANSPORT}${env.EMAIL_TRANSPORT === 'smtp' ? ` (${env.SMTP_HOST}:${env.SMTP_PORT}, secure=${env.SMTP_SECURE})` : ` → ${env.EMAIL_FILE_DIR}/`}`,
  );
  await mailer.verify();
  console.log('Connection OK.');
  const i = process.argv.indexOf('--to');
  const to = i > -1 ? process.argv[i + 1] : undefined;
  if (to) {
    await mailer.send({
      to,
      subject: 'MoveIITD: test email',
      text: 'This is a test message from the bus booking system. Email delivery is working.',
      html: '<p>This is a test message from the bus booking system. Email delivery is working.</p>',
    });
    console.log(`Test email sent to ${to}.`);
  }
}

main().catch((err) => {
  console.error('Email check failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
