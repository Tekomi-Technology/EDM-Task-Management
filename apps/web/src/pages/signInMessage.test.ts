import { afterEach, describe, expect, it } from 'vitest';
import { AuthError } from '../auth';
import { setLanguage } from '../i18n';
import { signInErrorText } from './SignInPage';

describe('signInErrorText', () => {
  afterEach(() => setLanguage('en', false));

  it("says in the person's language that the account has no role", () => {
    const err = new AuthError({
      statusCode: 403,
      code: 'NO_ROLE',
      message: 'Your account has no role yet. Ask an administrator.'
    });
    setLanguage('vi', false);
    expect(signInErrorText(err)).toBe('Tài khoản của bạn chưa có quyền. Hãy liên hệ Admin.');
    setLanguage('pt', false);
    expect(signInErrorText(err)).toBe('A sua conta ainda não tem função. Fale com um administrador.');
  });
});
