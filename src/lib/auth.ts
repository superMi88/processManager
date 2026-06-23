import { SignJWT, jwtVerify } from "jose";

const getSecretKey = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is not defined");
  }
  return new TextEncoder().encode(secret);
};

export async function signToken(payload: { email: string }) {
  try {
    const secret = getSecretKey();
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(secret);
  } catch (error) {
    console.error("Failed to sign JWT token:", error);
    return null;
  }
}

export async function verifyToken(token: string) {
  try {
    const secret = getSecretKey();
    const { payload } = await jwtVerify(token, secret);
    return payload as { email: string };
  } catch {
    // If token verification fails, return null
    return null;
  }
}
