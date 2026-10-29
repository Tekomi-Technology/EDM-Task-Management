import { hash, verify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';

/** argon2id with the library's defaults (19 MiB, 2 passes): the OWASP recommendation. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Checked against when the account does not exist, so a wrong username takes as long as a wrong password. */
export const NO_ACCOUNT_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$tF89W+sGYNVNT0BkYTC+pQ$w7GDotpSWCtL1CTaXsh3NGAhcqvel/VneDGQc/YQCeU';

/** 12 characters with upper and lower case letters and digits; avoids look-alike characters. */
export function temporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 9 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export type PasswordProblem = 'too_short' | 'letters_and_digits' | 'contains_username';

/** Why a password chosen by a person is refused, or null when it is good enough. */
export function passwordProblem(
  password: string,
  username: string,
  minLength: number
): PasswordProblem | null {
  if (password.length < minLength) return 'too_short';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'letters_and_digits';
  if (password.toLowerCase().includes(username.toLowerCase())) return 'contains_username';
  return null;
}

const PROBLEM_TEXT: Record<PasswordProblem, (minLength: number) => string> = {
  too_short: (n) => `The password needs at least ${n} characters`,
  letters_and_digits: () => 'The password needs letters and digits',
  contains_username: () => 'The password must not contain the username'
};
export const passwordProblemText = (p: PasswordProblem, minLength: number) => PROBLEM_TEXT[p](minLength);
