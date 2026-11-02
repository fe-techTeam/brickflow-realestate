import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "bf_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export interface SessionClaims {
  sub: string;
  mid: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ mid: claims.mid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuer("brickflow")
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "brickflow", algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.mid !== "string") return null;
    return { sub: payload.sub, mid: payload.mid };
  } catch {
    return null;
  }
}
