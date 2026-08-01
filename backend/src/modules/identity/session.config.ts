/**
 * How long a session lasts and what signs its token.
 *
 * Twelve hours is a working day plus the overrun: long enough that nobody is signed out
 * mid-task, short enough that an unattended machine is not an open door indefinitely. It is
 * not configurable because a per-deployment session lifetime is a setting nobody tunes well
 * and everybody eventually sets to a year.
 */
export const SESSION_TTL_HOURS = 12;

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Read at module construction so a deployment missing it fails at startup rather than at
 * the first sign-in. A default would be worse than no default: every deployment that forgot
 * to set it would share one publicly-known signing key and every token would be forgeable.
 */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or too short. It signs every session token, so it must ' +
        'be at least 32 characters and secret to this deployment. Copy backend/.env.example ' +
        'to backend/.env for a local value, and generate a real one with ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`.',
    );
  }

  return secret;
}
