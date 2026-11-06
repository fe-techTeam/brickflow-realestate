import { SignJWT, jwtVerify } from "jose";
import { SESSION_MAX_AGE_MS } from "./config";

export const SESSION_COOKIE = "bf_session";
export const SESSION_TTL_SECONDS = SESSION_MAX_AGE_MS / 1000;
/** Short-lived cookie between a correct password and the second factor; never grants access by itself. */
export const MFA_PENDING_COOKIE = "bf_mfa";
export const MFA_PENDING_TTL_SECONDS = 10 * 60;

const ISSUER = "brickflow";
const SESSION_AUDIENCE = "brickflow:session";
const MFA_AUDIENCE = "brickflow:mfa";

export interface SessionClaims {
  sub: string;
  mid: string;
  /** Server-side session id (JWT `jti`); the row must be active for the token to be accepted. */
  sid: string;
}

/** `enrolled` is handed to the browser (not a cookie) after first-time set-up, to finish signing in. */
export type MfaPendingPurpose = "challenge" | "enrol" | "enrolled";

export interface MfaPendingClaims {
  sub: string;
  mid: string;
  purpose: MfaPendingPurpose;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(claims: SessionClaims, expiresAt: Date): Promise<string> {
  return new SignJWT({ mid: claims.mid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.sid)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: SESSION_AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.mid !== "string" || typeof payload.jti !== "string") return null;
    return { sub: payload.sub, mid: payload.mid, sid: payload.jti };
  } catch {
    return null;
  }
}

export async function signMfaPendingToken(claims: MfaPendingClaims): Promise<string> {
  return new SignJWT({ mid: claims.mid, purpose: claims.purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${MFA_PENDING_TTL_SECONDS}s`)
    .setIssuer(ISSUER)
    .setAudience(MFA_AUDIENCE)
    .sign(secretKey());
}

export async function verifyMfaPendingToken(
  token: string | undefined,
  allowed: readonly MfaPendingPurpose[] = ["challenge", "enrol"],
): Promise<MfaPendingClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: MFA_AUDIENCE, algorithms: ["HS256"] });
    const purpose = payload.purpose;
    if (typeof payload.sub !== "string" || typeof payload.mid !== "string") return null;
    if (typeof purpose !== "string" || !(allowed as readonly string[]).includes(purpose)) return null;
    return { sub: payload.sub, mid: payload.mid, purpose: purpose as MfaPendingPurpose };
  } catch {
    return null;
  }
}
