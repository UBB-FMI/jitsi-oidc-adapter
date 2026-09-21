import { STATUS_CODE } from "jsr:@std/http@1.1.3/status";
import { encodeBase64 } from "jsr:@std/encoding@1.0.11/base64";
import { create, getNumericDate } from "jsr:@emrahcom/jwt@0.4.10";
import type { Algorithm } from "jsr:@emrahcom/jwt@0.4.10/algorithm";
import {
  AUTO_RETURN_TO_APP,
  HOSTNAME,
  JWT_ALG,
  JWT_APP_ID,
  JWT_APP_SECRET,
  JWT_EXP_SECOND,
  JWT_HASH,
  OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET,
  OIDC_ISSUER_URL,
  OIDC_SCOPES,
  PORT,
  PROSODY_CENSUS_URL,
  PUBLIC_URL,
} from "./config.ts";
import { createContext } from "./context.ts";
import type { UserInfo } from "./context.ts";
import { cookieValue, SignedTokens } from "./security.ts";
import {
  appLaunchPage,
  finishedPage,
  htmlResponse,
  landingPage,
  meetingPage,
  MeetingStore,
  myMeetingsPage,
  newMeetingPage,
  scheduledCreatedPage,
  waitingPage,
} from "./scheduler.ts";

// -----------------------------------------------------------------------------
// Globals
// -----------------------------------------------------------------------------
const DISCOVERY_URL = `${OIDC_ISSUER_URL}/.well-known/openid-configuration`;
let AUTH_ENDPOINT = "";
let TOKEN_ENDPOINT = "";
let USERINFO_ENDPOINT = "";
let CRYPTO_KEY: CryptoKey;
const MEETINGS = new MeetingStore(Boolean(PROSODY_CENSUS_URL));
const TOKENS = new SignedTokens(JWT_APP_SECRET);
const SESSION_COOKIE = "__Host-fmi_identity";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const APP_TICKET_SECONDS = 12 * 60 * 60;

interface StateType {
  android?: boolean;
  electron?: boolean;
  ios?: boolean;
  room?: string;
  tenant?: string;
  fmiAction?: string;
  meetingId?: string;
  mode?: string;
  startIso?: string;
  timeZone?: string;
  title?: string;
  [key: string]: boolean | string | undefined;
}

const enum ClientType {
  ios,
  android,
  electron,
  browser,
}

// -----------------------------------------------------------------------------
// Detect the client type by using the state data coming from the client.
// -----------------------------------------------------------------------------
function detectClientType(state: StateType): ClientType {
  if (state.ios) return ClientType.ios;
  if (state.android) return ClientType.android;
  if (state.electron) return ClientType.electron;

  return ClientType.browser;
}

// -----------------------------------------------------------------------------
// HTTP response for OK
// -----------------------------------------------------------------------------
function ok(body: string): Response {
  return new Response(body, {
    status: STATUS_CODE.OK,
  });
}

// -----------------------------------------------------------------------------
// HTTP response for NotFound
// -----------------------------------------------------------------------------
function notFound(): Response {
  return new Response(null, {
    status: STATUS_CODE.NotFound,
  });
}

// -----------------------------------------------------------------------------
// HTTP response for MethodNotAllowed
// -----------------------------------------------------------------------------
function methodNotAllowed(): Response {
  return new Response(null, {
    status: STATUS_CODE.MethodNotAllowed,
  });
}

// -----------------------------------------------------------------------------
// HTTP response for Unauthorized
// -----------------------------------------------------------------------------
function unauthorized(): Response {
  return new Response(null, {
    status: STATUS_CODE.Unauthorized,
  });
}

function seeOther(url: string): Response {
  return Response.redirect(url, 303);
}

function publicOrigin(req: Request): string {
  return getExternalUrl(req).origin;
}

function userDisplayName(userInfo: UserInfo): string {
  return userInfo.name?.trim() || userInfo.preferred_username?.trim() ||
    userInfo.email?.trim() || "FMI moderator";
}

async function sessionUser(req: Request): Promise<UserInfo | undefined> {
  const token = cookieValue(req.headers.get("cookie") || "", SESSION_COOKIE);
  const claims = await TOKENS.verify("session", token);
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return undefined;
  return {
    sub: claims.sub,
    name: typeof claims.name === "string" ? claims.name : undefined,
    email: typeof claims.email === "string" ? claims.email : undefined,
  };
}

async function redirectWithSession(url: string, userInfo: UserInfo): Promise<Response> {
  const token = await TOKENS.issue("session", {
    sub: userInfo.sub,
    name: userDisplayName(userInfo).slice(0, 120),
    email: (userInfo.email || "").slice(0, 200),
  }, SESSION_SECONDS);
  return new Response(null, {
    status: 303,
    headers: {
      Location: url,
      "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
      "Cache-Control": "no-store",
    },
  });
}

// -----------------------------------------------------------------------------
// Generate and set the crypto key at the beginning and use the same crypto key
// during the process lifetime.
// -----------------------------------------------------------------------------
async function setCryptoKey() {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(JWT_APP_SECRET);

  CRYPTO_KEY = await crypto.subtle.importKey(
    "raw",
    keyData,
    {
      name: "HMAC",
      hash: JWT_HASH,
    },
    true,
    ["sign", "verify"],
  );
}

// -----------------------------------------------------------------------------
// Discover OIDC endpoints.
// -----------------------------------------------------------------------------
async function getEndpoints() {
  try {
    const res = await fetch(DISCOVERY_URL);
    if (!res.ok) throw new Error("Failed to get endpoints");

    const config = await res.json();
    AUTH_ENDPOINT = config.authorization_endpoint || "";
    TOKEN_ENDPOINT = config.token_endpoint || "";
    USERINFO_ENDPOINT = config.userinfo_endpoint || "";

    if (!AUTH_ENDPOINT || !TOKEN_ENDPOINT || !USERINFO_ENDPOINT) {
      throw new Error("Missing endpoint");
    }

    console.log(`AUTH_ENDPOINT: ${AUTH_ENDPOINT}`);
    console.log(`TOKEN_ENDPOINT: ${TOKEN_ENDPOINT}`);
    console.log(`USERINFO_ENDPOINT: ${USERINFO_ENDPOINT}`);
  } catch (e) {
    console.error(e);
  }
}

// -----------------------------------------------------------------------------
// Prepare the auth URI for the OIDC auth page.
// -----------------------------------------------------------------------------
async function getAuthUri(redirectUri: string, state: string) {
  if (!AUTH_ENDPOINT) await getEndpoints();
  if (!AUTH_ENDPOINT) throw new Error("Missing authentication endpoint");

  const params = new URLSearchParams({
    client_id: OIDC_CLIENT_ID,
    response_type: "code",
    scope: OIDC_SCOPES,
    redirect_uri: redirectUri,
    state: state,
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// -----------------------------------------------------------------------------
// Use the configured public URL instead of trusting the reverse-proxy Host
// header. Falling back to Host preserves upstream behavior for other users.
// -----------------------------------------------------------------------------
function getExternalUrl(req: Request): URL {
  const configured = PUBLIC_URL.trim();
  const host = req.headers.get("host");
  const externalUrl = new URL(configured || `https://${host}`);

  if (externalUrl.protocol !== "https:") {
    throw new Error("PUBLIC_URL must use https");
  }

  return externalUrl;
}

// -----------------------------------------------------------------------------
// Redirect the user to the OIDC auth page to get the short-term auth code.
// -----------------------------------------------------------------------------
async function auth(req: Request): Promise<Response> {
  try {
    const externalUrl = getExternalUrl(req);

    const url = new URL(req.url);
    const state = url.searchParams.get("state");
    if (!state) throw new Error("state not found");

    const redirectUri = new URL("/oidc/tokenize", externalUrl).toString();
    const authPage = await getAuthUri(redirectUri, state);

    return Response.redirect(authPage, STATUS_CODE.Found);
  } catch (e) {
    console.error(e);
    return unauthorized();
  }
}

// -----------------------------------------------------------------------------
// - Sub is tenant (if exists). If not then sub is the meeting domain (host).
// - Tenant is the previous folder in Jitsi's path before the room name.
// - stateTenant (as input) doesn't contain the room name. So, get the last
//   folder.
// - stateTenant doesn't exist all the times. So, it may be undefined.
// -----------------------------------------------------------------------------
function getSub(host: string, stateTenant: string | undefined): string {
  if (!stateTenant) return host;

  // trim trailing slashes
  const tenantPath = stateTenant.replace(/\/+$/g, "");

  // get the latest folder from the path
  const tenant = tenantPath.split("/").at(-1);

  return tenant || host;
}

// -----------------------------------------------------------------------------
// Get the access token by using the short-term auth code.
// -----------------------------------------------------------------------------
async function getAccessToken(
  host: string,
  code: string,
  jsonState: string,
): Promise<string> {
  const redirectUri = `https://${host}/oidc/tokenize`;

  const headers = new Headers();
  headers.append("Accept", "application/json");

  const data = new URLSearchParams();
  data.append("grant_type", "authorization_code");
  data.append("redirect_uri", redirectUri);
  data.append("code", code);
  data.append("state", jsonState);

  if (OIDC_CLIENT_SECRET) {
    headers.append(
      "Authorization",
      "Basic " + encodeBase64(`${OIDC_CLIENT_ID}:${OIDC_CLIENT_SECRET}`),
    );
  } else {
    data.append("client_id", OIDC_CLIENT_ID);
  }

  if (!TOKEN_ENDPOINT) await getEndpoints();
  if (!TOKEN_ENDPOINT) throw new Error("Missing token endpoint");

  // Send the request for the access token.
  const res = await fetch(TOKEN_ENDPOINT, {
    headers: headers,
    method: "POST",
    body: data,
  });
  const json = await res.json();
  const accessToken = json.access_token;
  if (!accessToken) throw new Error("access-token request failed");

  return accessToken;
}

// -----------------------------------------------------------------------------
// Get the user info from OIDC by using the access token.
// -----------------------------------------------------------------------------
async function getUserInfo(
  accessToken: string,
): Promise<UserInfo> {
  if (!USERINFO_ENDPOINT) await getEndpoints();
  if (!USERINFO_ENDPOINT) throw new Error("Missing userinfo endpoint");

  // Send request for the user info.
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    method: "GET",
  });
  const userInfo = await res.json() as UserInfo;

  // Sub is the mandotary field in response for a successful request.
  if (!userInfo.sub) throw new Error("No user info");

  return userInfo;
}

// -----------------------------------------------------------------------------
// Generate Jitsi's token (jwt).
// -----------------------------------------------------------------------------
async function generateJwt(
  sub: string,
  room: string,
  userInfo: UserInfo,
  lifetimeSeconds = JWT_EXP_SECOND,
): Promise<string> {
  const header = { typ: "JWT", alg: JWT_ALG as Algorithm };
  const payload = {
    aud: JWT_APP_ID,
    iss: JWT_APP_ID,
    sub: sub,
    room: room,
    iat: getNumericDate(0),
    nbf: getNumericDate(0),
    exp: getNumericDate(lifetimeSeconds),
    context: createContext(userInfo),
  };

  return await create(header, payload, CRYPTO_KEY);
}

// -----------------------------------------------------------------------------
// Generate hashes for Jitsi session.
// -----------------------------------------------------------------------------
function generateHash(jsonState: string): string {
  let hash = "adapter=true";

  try {
    const state = JSON.parse(jsonState) as StateType;

    for (const key in state) {
      // See https://github.com/jitsi/jitsi-meet for allowed hashes.
      // react/features/authentication/functions.any.ts
      if (
        !key.startsWith("config.") &&
        !key.startsWith("interfaceConfig.") &&
        !key.startsWith("iceServers.")
      ) continue;

      hash = `${hash}&${encodeURIComponent(key)}`;
      hash = `${hash}=${encodeURIComponent(JSON.stringify(state[key]))}`;
    }
  } catch (e) {
    console.error(e);
  }

  return hash;
}

// -----------------------------------------------------------------------------
// Create URI of the Jitsi meeting with a token and hashes.
// Use URI scheme depending on the detected client type.
// -----------------------------------------------------------------------------
function getMeetingUri(
  host: string,
  tenant: string | undefined,
  room: string,
  jwt: string,
  hash: string,
  client: ClientType,
): string {
  const clientUriScheme: Record<ClientType, string> = {
    [ClientType.ios]: "org.jitsi.meet",
    [ClientType.android]: "intent",
    [ClientType.electron]: "jitsi-meet",
    [ClientType.browser]: "https",
  };

  const scheme = clientUriScheme[client];

  tenant = tenant || "";

  let uri = `${host}/${tenant}/${room}`;
  uri = uri.replace(/\/+/g, "/");
  uri = `${scheme}://${uri}?jwt=${encodeURIComponent(jwt)}`;
  if (client == ClientType.android) {
    return `${uri}#Intent;scheme=org.jitsi.meet;package=org.jitsi.meet;end`;
  }
  return `${uri}#${hash}`;
}

// -----------------------------------------------------------------------------
// Generate the response for the tokenize endpoint.
// -----------------------------------------------------------------------------
function generateTokenizeResponse(uri: string, client: ClientType): Response {
  // Normal browser client, redirect to the meeting page.
  if (client == ClientType.browser) {
    return Response.redirect(uri, STATUS_CODE.Found);
  }

  // Show page in web browser that feeds JWT to other clients.
  const body = `<!DOCTYPE html>
    <html>
    <head>
      <title>Meeting Authentication</title>
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, shrink-to-fit=no"
      >
    </head>
    <body>
      <h1>Meeting Authentication</h1>
      <p>
        <a href="${uri}">
          <strong>Finish authentication and return to app</strong>
        </a>
      </p>
      <p>
        <small>After successful authentication, this tab can be closed.</small>
      </p>
    </body>
    </html>`;

  const headers = new Headers();
  headers.append("Content-Type", "text/html");
  if (AUTO_RETURN_TO_APP) headers.append("Refresh", `0; url=${uri}`);

  return new Response(body, { headers: headers });
}

// -----------------------------------------------------------------------------
// - User comes here after redirected by the auth page with a short-term code
// - Get the OIDC access token by using this short-term auth code
// - Get the OIDC user info by using the access code
// - Generate Jitsi's token by using the user info
// - Redirect the user to Jitsi's meeting page with a token and hashes
// -----------------------------------------------------------------------------
async function tokenize(req: Request): Promise<Response> {
  try {
    const externalUrl = getExternalUrl(req);
    const host = externalUrl.host;

    const url = new URL(req.url);
    const searchParams = url.searchParams;

    const code = searchParams.get("code");
    if (!code) throw new Error("code not found");

    const jsonState = searchParams.get("state");
    if (!jsonState) throw new Error("state not found");

    const state = JSON.parse(jsonState) as StateType;
    // Get the OIDC access token by using the short-term auth code.
    const accessToken = await getAccessToken(host, code, jsonState);
    // Get the OIDC user info by using the access token.
    const userInfo = await getUserInfo(accessToken);

    if (state.fmiAction === "mine") {
      return await redirectWithSession(`${externalUrl.origin}/fmi/mine`, userInfo);
    }

    if (state.fmiAction === "create") {
      const title = state.title?.trim() || "FMI meeting";
      if (title.length > 120) throw new Error("meeting title too long");
      let startAt = new Date();
      if (state.mode === "schedule") {
        startAt = new Date(state.startIso || "");
        if (!Number.isFinite(startAt.getTime()) || startAt.getTime() < Date.now() - 60_000 ||
          startAt.getTime() > Date.now() + 2 * 365 * 24 * 60 * 60 * 1000) {
          throw new Error("invalid scheduled start");
        }
      }
      const meeting = await MEETINGS.create({
        title,
        creatorSub: userInfo.sub,
        creatorName: userDisplayName(userInfo),
        startAt,
        creatorTimeZone: state.timeZone?.slice(0, 80) || "UTC",
      });
      if (state.mode !== "schedule") {
        await MEETINGS.openEarly(meeting);
        return await redirectWithSession(`${externalUrl.origin}/m/${meeting.id}`, userInfo);
      }
      return await redirectWithSession(`${externalUrl.origin}/m/${meeting.id}?created=1`, userInfo);
    }

    if (state.fmiAction === "host") {
      const meeting = MEETINGS.get(state.meetingId || "");
      if (!meeting || meeting.finishedAt || meeting.creatorSub !== userInfo.sub) {
        return unauthorized();
      }
      return await redirectWithSession(`${externalUrl.origin}/m/${meeting.id}`, userInfo);
    }

    const sub = getSub(host, state.tenant);
    const room = state.room;
    if (!room) throw new Error("room not found in state");
    if (room.startsWith("_fmi_")) {
      const meeting = MEETINGS.findByInternalRoom(room);
      if (!meeting || meeting.finishedAt || meeting.creatorSub !== userInfo.sub) return unauthorized();
      return await redirectWithSession(`${externalUrl.origin}/m/${meeting.id}`, userInfo);
    }
    // Detect client type
    const client = detectClientType(state);
    // Generate Jitsi token.
    const jwt = await generateJwt(sub, room, userInfo);
    // Generate Jitsi hash.
    const hash = generateHash(jsonState);
    // Get URI of the Jitsi meeting. Use unmodified path (state.tenant) which is
    // different than the tenant in JWT context.
    const uri = getMeetingUri(host, state.tenant, room, jwt, hash, client);

    return generateTokenizeResponse(uri, client);
  } catch (e) {
    console.error(e);
    return unauthorized();
  }
}

async function createMeeting(req: Request): Promise<Response> {
  const form = await req.formData();
  const title = String(form.get("title") || "").trim();
  const mode = String(form.get("mode") || "");
  const startIso = String(form.get("startIso") || "");
  const timeZone = String(form.get("timeZone") || "UTC");
  if (!title || title.length > 120 || !["now", "schedule"].includes(mode)) {
    return htmlResponse("Invalid meeting details", 400);
  }
  if (mode === "schedule") {
    const start = new Date(startIso);
    if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now() ||
      start.getTime() > Date.now() + 2 * 365 * 24 * 60 * 60 * 1000) {
      return htmlResponse("Invalid scheduled start", 400);
    }
  }
  const state = JSON.stringify({ fmiAction: "create", title, mode, startIso, timeZone });
  return seeOther(`${publicOrigin(req)}/oidc/auth?state=${encodeURIComponent(state)}`);
}

async function meetingRoute(req: Request, id: string): Promise<Response> {
  const meeting = MEETINGS.get(id);
  if (!meeting) return htmlResponse("Meeting not found", 404);
  if (meeting.finishedAt) return htmlResponse(finishedPage(meeting), 410);
  const url = new URL(req.url);
  const user = await sessionUser(req);
  const host = user?.sub === meeting.creatorSub;
  if (url.searchParams.get("created") === "1" && host) {
    return htmlResponse(scheduledCreatedPage(meeting, publicOrigin(req)));
  }
  if (!host && !MEETINGS.isOpen(meeting)) return htmlResponse(waitingPage(meeting));
  const hostJwt = host ? await generateJwt(getExternalUrl(req).host, `_fmi_${meeting.room}`, user) : "";
  return htmlResponse(meetingPage(meeting, hostJwt), 200, {
    "Set-Cookie": MEETINGS.cookieFor(meeting, host),
    "Referrer-Policy": "no-referrer",
  });
}

async function hostRoute(req: Request, id: string): Promise<Response> {
  const meeting = MEETINGS.get(id);
  if (!meeting) return htmlResponse("Meeting not found", 404);
  if (meeting.finishedAt) return htmlResponse(finishedPage(meeting), 410);
  if ((await sessionUser(req))?.sub === meeting.creatorSub) {
    return seeOther(`${publicOrigin(req)}/m/${meeting.id}`);
  }
  const state = JSON.stringify({ fmiAction: "host", meetingId: meeting.id });
  return seeOther(`${publicOrigin(req)}/oidc/auth?state=${encodeURIComponent(state)}`);
}

async function myMeetingsRoute(req: Request): Promise<Response> {
  const user = await sessionUser(req);
  if (!user) {
    const state = JSON.stringify({ fmiAction: "mine" });
    return seeOther(`${publicOrigin(req)}/oidc/auth?state=${encodeURIComponent(state)}`);
  }
  return htmlResponse(myMeetingsPage(MEETINGS.listByCreator(user.sub), publicOrigin(req)));
}

async function cancelMeeting(req: Request, id: string): Promise<Response> {
  if (req.headers.get("origin") !== publicOrigin(req)) return unauthorized();
  const user = await sessionUser(req);
  const meeting = MEETINGS.get(id);
  if (!user || !meeting || meeting.creatorSub !== user.sub) return unauthorized();
  if (PROSODY_CENSUS_URL) {
    try {
      await pollProsodyCensus();
    } catch {
      return htmlResponse("Meeting status is temporarily unavailable. Please try again shortly.", 503);
    }
  }
  const result = await MEETINGS.cancel(meeting);
  if (result === "unknown") return htmlResponse("Meeting status is temporarily unavailable. Please try again shortly.", 503);
  if (result === "active") return htmlResponse("This meeting is in progress and cannot be cancelled.", 409);
  return seeOther(`${publicOrigin(req)}/fmi/mine`);
}

async function appRoute(req: Request, id: string): Promise<Response> {
  const meeting = MEETINGS.get(id);
  if (!meeting) return htmlResponse("Meeting not found", 404);
  if (meeting.finishedAt) return htmlResponse(finishedPage(meeting), 410);
  const user = await sessionUser(req);
  const host = user?.sub === meeting.creatorSub;
  if (!host && !MEETINGS.isOpen(meeting)) return htmlResponse(waitingPage(meeting));

  const internalRoom = `_fmi_${meeting.room}`;
  const ticket = await TOKENS.issue("app", {
    id: meeting.id,
    room: internalRoom,
    role: host ? "host" : "guest",
  }, APP_TICKET_SECONDS);
  const params = new URLSearchParams({ fmiTicket: ticket });
  if (host) {
    params.set("jwt", await generateJwt(getExternalUrl(req).host, internalRoom, user, APP_TICKET_SECONDS));
  }
  // The native fragment parser does not treat '+' as a space. URLSearchParams
  // would form-encode the subject and show literal plus signs in the app.
  const overrides = [
    ["config.subject", JSON.stringify(meeting.title)],
    ["config.brandingRoomAlias", JSON.stringify(`m/${meeting.id}`)],
    ["config.doNotStoreRoom", "true"],
  ].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const agent = req.headers.get("user-agent") || "";
  const preferred = new URL(req.url).searchParams.get("platform");
  const platform = preferred === "android" || preferred === "ios" || preferred === "windows"
    ? preferred
    : /Android/i.test(agent) ? "android" : /iPhone|iPad|iPod/i.test(agent) ? "ios" : "windows";
  const path = `${getExternalUrl(req).host}/${internalRoom}?${params}#${overrides}`;
  const appUrl = `${platform === "windows" ? "jitsi-meet" : "org.jitsi.meet"}://${path}`;
  return htmlResponse(appLaunchPage(meeting, publicOrigin(req), appUrl), 200, {
    "Referrer-Policy": "no-referrer",
  });
}

async function authorizeRoom(req: Request): Promise<Response> {
  const original = req.headers.get("x-original-uri") || "";
  const room = original.split(/[?#]/, 1)[0].replace(/^\//, "");
  const meeting = MEETINGS.findByInternalRoom(room);
  if (!meeting || meeting.finishedAt) return unauthorized();
  if (MEETINGS.authorizeCookie(req.headers.get("cookie") || "", room)) {
    return new Response(null, { status: 204 });
  }
  const ticket = new URL(original, publicOrigin(req)).searchParams.get("fmiTicket") || "";
  const claims = await TOKENS.verify("app", ticket);
  const allowed = claims?.id === meeting.id && claims.room === room &&
    (claims.role === "host" || claims.role === "guest" && MEETINGS.isOpen(meeting));
  return new Response(null, { status: allowed ? 204 : 401 });
}

async function updatePresence(req: Request): Promise<Response> {
  const form = await req.formData();
  const meeting = MEETINGS.get(String(form.get("meetingId") || ""));
  if (!meeting || !MEETINGS.authorizeCookie(
    req.headers.get("cookie") || "",
    `_fmi_${meeting.room}`,
  )) return unauthorized();
  const action = String(form.get("action") || "");
  if (action === "join" && !MEETINGS.isOpen(meeting)) await MEETINGS.openEarly(meeting);
  await MEETINGS.presence(
    meeting,
    String(form.get("sessionId") || ""),
    action,
  );
  return ok("ok");
}

// -----------------------------------------------------------------------------
// handler
// -----------------------------------------------------------------------------
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "POST" && path === "/fmi/create") return await createMeeting(req);
  if (req.method === "POST" && path.startsWith("/fmi/cancel/")) {
    return await cancelMeeting(req, path.slice("/fmi/cancel/".length));
  }
  if (req.method === "POST" && path === "/fmi/presence") return await updatePresence(req);
  if (req.method !== "GET") return methodNotAllowed();

  if (path === "/health") {
    return ok("healthy");
  } else if (path === "/oidc/health") {
    return ok("healthy");
  } else if (path === "/oidc/auth") {
    return await auth(req);
  } else if (path === "/oidc/tokenize") {
    return await tokenize(req);
  } else if (path === "/fmi/landing") {
    return htmlResponse(landingPage());
  } else if (path === "/fmi/new") {
    return htmlResponse(newMeetingPage());
  } else if (path === "/fmi/mine") {
    return await myMeetingsRoute(req);
  } else if (path === "/fmi/authorize") {
    return await authorizeRoom(req);
  } else if (path.startsWith("/fmi/app/")) {
    return await appRoute(req, path.slice("/fmi/app/".length));
  } else if (path.startsWith("/fmi/status/")) {
    const meeting = MEETINGS.get(path.slice("/fmi/status/".length));
    if (!meeting) return notFound();
    return Response.json({
      open: MEETINGS.isOpen(meeting),
      finished: Boolean(meeting.finishedAt),
      startAt: meeting.startAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } else if (path.startsWith("/fmi/host/")) {
    return await hostRoute(req, path.slice("/fmi/host/".length));
  } else if (path.startsWith("/m/")) {
    return await meetingRoute(req, path.slice("/m/".length));
  } else {
    return notFound();
  }
}

async function pollProsodyCensus(): Promise<void> {
  if (!PROSODY_CENSUS_URL) return;
  const response = await fetch(PROSODY_CENSUS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Prosody census returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.room_census)) throw new Error("invalid Prosody census");
  const counts = new Map<string, number>();
  for (const room of payload.room_census) {
    const name = String(room?.room_name || "").split("@", 1)[0].toLowerCase();
    if (!/^_fmi_[a-f0-9]{32}$/.test(name)) continue;
    const number = Number(room?.participants);
    if (!Number.isSafeInteger(number) || number < 0) continue;
    counts.set(name, room?.leaked ? 0 : number);
  }
  await MEETINGS.reconcileCensus(counts);
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------
async function main() {
  // Generate the crypto key and use it during the process lifetime.
  await setCryptoKey();
  await MEETINGS.init();
  setInterval(() => MEETINGS.sweep().catch(console.error), 30_000);
  if (PROSODY_CENSUS_URL) {
    const poll = () => pollProsodyCensus().catch((error) => console.error("Prosody census unavailable:", error));
    poll();
    setInterval(poll, 30_000);
  }

  // Get OIDC endpoints. It will try later if it fails in the initial try.
  await getEndpoints();

  console.log(`OIDC_ISSUER_URL: ${OIDC_ISSUER_URL}`);
  console.log(`OIDC_CLIENT_ID: ${OIDC_CLIENT_ID}`);
  console.log(
    `OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET ? "*** masked ***" : "not used"}`,
  );
  console.log(`OIDC_SCOPES: ${OIDC_SCOPES}`);
  console.log(`PUBLIC_URL: ${PUBLIC_URL || "derived from request"}`);
  console.log(`JWT_ALG: ${JWT_ALG}`);
  console.log(`JWT_HASH: ${JWT_HASH}`);
  console.log(`JWT_APP_ID: ${JWT_APP_ID}`);
  console.log(`JWT_APP_SECRET: *** masked ***`);
  console.log(`JWT_EXP_SECOND: ${JWT_EXP_SECOND}`);
  console.log(`HOSTNAME: ${HOSTNAME}`);
  console.log(`PORT: ${PORT}`);
  console.log(`AUTO_RETURN_TO_APP: ${AUTO_RETURN_TO_APP}`);

  const controller = new AbortController();
  const shutdown = () => controller.abort();
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  try {
    const server = Deno.serve({
      hostname: HOSTNAME,
      port: PORT,
      signal: controller.signal,
    }, handler);

    // Wait the web server until the clean shutdown.
    await server.finished;
  } finally {
    Deno.removeSignalListener("SIGINT", shutdown);
    Deno.removeSignalListener("SIGTERM", shutdown);
  }
}

// -----------------------------------------------------------------------------
main();
