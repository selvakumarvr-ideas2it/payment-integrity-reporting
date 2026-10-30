import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './auth';

describe('password verify', () => {
  it('accepts the password that was hashed and rejects a different one', () => {
    const stored = hashPassword('Password123!');
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword('Password123!', stored)).toBe(true);
    expect(verifyPassword('password123!', stored)).toBe(false);
    expect(verifyPassword('Password123!', 'not-a-hash')).toBe(false);
    expect(verifyPassword('Password123!', '')).toBe(false);
  });
});
