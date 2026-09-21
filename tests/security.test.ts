import { cookieValue, SignedTokens } from "../src/security.ts";

Deno.test("signed grants reject tampering and wrong purposes", async () => {
  const tokens = new SignedTokens("test-secret-long-enough-for-hmac");
  const ticket = await tokens.issue("app", { id: "abc", role: "guest" }, 60);
  const claims = await tokens.verify("app", ticket);
  if (claims?.id !== "abc" || claims.role !== "guest") {
    throw new Error("valid ticket rejected");
  }
  if (await tokens.verify("session", ticket)) {
    throw new Error("purpose confusion");
  }
  const [body, signature] = ticket.split(".");
  if (await tokens.verify("app", `${body.slice(0, -1)}x.${signature}`)) {
    throw new Error("tampered ticket accepted");
  }
  const expired = await tokens.issue("app", { id: "abc" }, -1);
  if (await tokens.verify("app", expired)) {
    throw new Error("expired ticket accepted");
  }
});

Deno.test("cookie parsing requires the exact cookie name", () => {
  const header =
    "not__Host-fmi_identity=wrong; __Host-fmi_identity=correct; other=value";
  if (cookieValue(header, "__Host-fmi_identity") !== "correct") {
    throw new Error("wrong cookie");
  }
});
