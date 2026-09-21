const encoder = new TextEncoder();

function base64Url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid token encoding");
  }
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export class SignedTokens {
  #key: Promise<CryptoKey>;

  constructor(secret: string) {
    this.#key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  async issue(
    purpose: string,
    claims: Record<string, unknown>,
    lifetimeSeconds: number,
  ): Promise<string> {
    const body = base64Url(encoder.encode(JSON.stringify({
      purpose,
      claims,
      expires: Math.floor(Date.now() / 1000) + lifetimeSeconds,
    })));
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", await this.#key, encoder.encode(body)),
    );
    return `${body}.${base64Url(signature)}`;
  }

  async verify(
    purpose: string,
    token: string,
  ): Promise<Record<string, unknown> | undefined> {
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || body.length > 4096) return undefined;
    try {
      const signatureBytes = decodeBase64Url(signature);
      const signatureBuffer = new ArrayBuffer(signatureBytes.length);
      new Uint8Array(signatureBuffer).set(signatureBytes);
      const valid = await crypto.subtle.verify(
        "HMAC",
        await this.#key,
        signatureBuffer,
        encoder.encode(body),
      );
      if (!valid) return undefined;
      const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(body)));
      if (
        value?.purpose !== purpose || !Number.isSafeInteger(value.expires) ||
        value.expires <= Math.floor(Date.now() / 1000) ||
        !value.claims || typeof value.claims !== "object" ||
        Array.isArray(value.claims)
      ) return undefined;
      return value.claims;
    } catch {
      return undefined;
    }
  }
}

export function cookieValue(header: string, name: string): string {
  return header.split(";").map((item) => item.trim()).find((item) =>
    item.startsWith(`${name}=`)
  )
    ?.slice(name.length + 1) || "";
}
