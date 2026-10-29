/**
 * Gives a person a temporary password from the server's command line, for when nobody can sign in as an
 * administrator (the first start, or a forgotten admin password). They choose their own at the next sign-in.
 *
 *   node dist/db/set-password.js <username>                       # existing account
 *   node dist/db/set-password.js <username> --admin "Full Name"   # creates an administrator if there is none by that name
 *
 * In Docker: docker compose exec api node dist/db/set-password.js admin.edm --admin "Admin EDM"
 */
import { eq, sql } from 'drizzle-orm';
import { hashPassword, temporaryPassword } from '../auth/passwords';
import { loadEnv } from '../config/env';
import { createDb } from './db.module';
import { sessions, users } from './schema';

async function main(): Promise<void> {
  const [username, flag, fullName] = process.argv.slice(2);
  if (!username || (flag && (flag !== '--admin' || !fullName))) {
    console.error('Usage: set-password <username> [--admin "Full Name"]');
    process.exitCode = 2;
    return;
  }
  const { pool, db } = createDb(loadEnv().DATABASE_URL);
  try {
    const password = temporaryPassword();
    const passwordHash = await hashPassword(password);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()}`);
    if (existing) {
      await db
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: true,
          failedSignIns: 0,
          lockedUntil: null,
          status: 'active'
        })
        .where(eq(users.id, existing.id));
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, existing.id));
    } else if (flag === '--admin') {
      await db
        .insert(users)
        .values({ username, fullName, roles: ['admin'], passwordHash, mustChangePassword: true });
    } else {
      console.error(`No account "${username}". Add --admin "Full Name" to create an administrator.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Temporary password for ${username}: ${password}`);
    console.log('It must be changed at the next sign-in.');
  } finally {
    await pool.end();
  }
}

void main();
