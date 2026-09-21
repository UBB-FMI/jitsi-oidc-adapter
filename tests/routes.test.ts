import { MeetingStore } from "../src/scheduler.ts";
import { SignedTokens } from "../src/security.ts";

Deno.test("scheduler routes enforce ownership and app tickets", async () => {
  const dir = await Deno.makeTempDir();
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const secret = "integration-test-secret-not-used-in-production";
  const store = new MeetingStore(false, `${dir}/meetings.json`);
  await store.init();
  const future = await store.create({
    title: "Future private meeting",
    creatorSub: "creator-one",
    creatorName: "Creator One",
    startAt: new Date(Date.now() + 3_600_000),
    creatorTimeZone: "Europe/Bucharest",
  });
  const open = await store.create({
    title: "Open meeting",
    creatorSub: "creator-one",
    creatorName: "Creator One",
    startAt: new Date(Date.now() - 3_600_000),
    creatorTimeZone: "UTC",
  });
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--cached-only",
      "--allow-env",
      "--allow-net",
      `--allow-read=${dir}`,
      `--allow-write=${dir}`,
      "src/adapter.ts",
    ],
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      PUBLIC_URL: "https://meet.example",
      OIDC_ISSUER_URL: "http://127.0.0.1:1",
      JWT_APP_ID: "test-app",
      JWT_APP_SECRET: secret,
      SCHEDULER_DATA_FILE: `${dir}/meetings.json`,
    },
    stdout: "null",
    stderr: "null",
  }).spawn();
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch(`${base}/health`);
        ready = response.ok;
        await response.body?.cancel();
        if (ready) break;
      } catch { /* server not ready */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("adapter did not start");

    const tokens = new SignedTokens(secret);
    const ownerSession = await tokens.issue("session", {
      sub: "creator-one",
      name: "Creator One",
    }, 60);
    const otherSession = await tokens.issue(
      "session",
      { sub: "creator-two" },
      60,
    );
    const owner = { Cookie: `__Host-fmi_identity=${ownerSession}` };
    const other = { Cookie: `__Host-fmi_identity=${otherSession}` };

    const futureGuest = await (await fetch(`${base}/m/${future.id}`)).text();
    if (!futureGuest.includes("has not started yet")) {
      throw new Error("future guest bypassed wait");
    }
    const futureOwner =
      await (await fetch(`${base}/m/${future.id}`, { headers: owner })).text();
    if (
      !futureOwner.includes("jwt:") ||
      !futureOwner.includes("brandingRoomAlias")
    ) {
      throw new Error("creator did not enter as moderator");
    }
    const futureOther =
      await (await fetch(`${base}/m/${future.id}`, { headers: other })).text();
    if (!futureOther.includes("has not started yet")) {
      throw new Error("other user became moderator");
    }
    const mine = await (await fetch(`${base}/fmi/mine`, { headers: owner }))
      .text();
    if (!mine.includes(`/m/${future.id}`) || !mine.includes(`/m/${open.id}`)) {
      throw new Error("creator meeting list incomplete");
    }
    const deniedMine = await fetch(`${base}/fmi/mine`, {
      headers: other,
      redirect: "manual",
    });
    if ((await deniedMine.text()).includes(future.title)) {
      throw new Error("other user's list leaked meeting");
    }

    const waitingApp = await (await fetch(`${base}/fmi/app/${future.id}`))
      .text();
    if (waitingApp.includes("org.jitsi.meet://")) {
      throw new Error("future guest received app launch");
    }
    const ownerApp =
      await (await fetch(`${base}/fmi/app/${future.id}?platform=android`, {
        headers: owner,
      })).text();
    const titleOverride = `config.subject=${
      encodeURIComponent(JSON.stringify(future.title))
    }`;
    const aliasOverride = `config.brandingRoomAlias=${
      encodeURIComponent(JSON.stringify(`m/${future.id}`))
    }`;
    if (
      !ownerApp.includes("org.jitsi.meet://") || !ownerApp.includes("jwt=") ||
      !ownerApp.includes(`#${titleOverride}`) ||
      !ownerApp.includes(aliasOverride) ||
      !ownerApp.includes("config.doNotStoreRoom=true")
    ) {
      throw new Error("owner Android handoff invalid");
    }
    const guestApp =
      await (await fetch(`${base}/fmi/app/${open.id}?platform=ios`)).text();
    if (
      !guestApp.includes("org.jitsi.meet://") ||
      !guestApp.includes(
        `config.subject=${encodeURIComponent(JSON.stringify(open.title))}`,
      )
    ) {
      throw new Error("guest handoff invalid");
    }
    const ticket = guestApp.match(/fmiTicket=([A-Za-z0-9_.-]+)/)?.[1];
    if (!ticket) throw new Error("guest ticket missing");
    if (guestApp.includes("jwt=")) {
      throw new Error("anonymous guest received a moderator JWT");
    }
    const internalRoom = `_fmi_${open.room}`;
    const authorize = async (uri: string) => {
      const response = await fetch(`${base}/fmi/authorize`, {
        headers: { "X-Original-URI": uri },
      });
      const status = response.status;
      await response.body?.cancel();
      return status;
    };
    if (await authorize(`/${internalRoom}?fmiTicket=${ticket}`) !== 204) {
      throw new Error("valid app ticket rejected");
    }
    if (await authorize(`/${internalRoom}?jwt=madeup`) !== 401) {
      throw new Error("unrecognized native JWT accepted");
    }
    if (await authorize(`/_fmi_${future.room}?fmiTicket=${ticket}`) !== 401) {
      throw new Error("ticket accepted for another room");
    }
    if (await authorize(`/${internalRoom}`) !== 401) {
      throw new Error("internal room accepted without grant");
    }
    const cancelUrl = `${base}/fmi/cancel/${future.id}`;
    const badOrigin = await fetch(cancelUrl, {
      method: "POST",
      headers: { ...owner, Origin: "https://evil.example" },
      redirect: "manual",
    });
    if (badOrigin.status !== 401) throw new Error("cross-origin cancellation accepted");
    await badOrigin.body?.cancel();
    const wrongOwner = await fetch(cancelUrl, {
      method: "POST",
      headers: { ...other, Origin: "https://meet.example" },
      redirect: "manual",
    });
    if (wrongOwner.status !== 401) throw new Error("non-creator cancelled meeting");
    await wrongOwner.body?.cancel();
    const cancelled = await fetch(cancelUrl, {
      method: "POST",
      headers: { ...owner, Origin: "https://meet.example" },
      redirect: "manual",
    });
    const closedLink = await fetch(`${base}/m/${future.id}`);
    if (cancelled.status !== 303 || closedLink.status !== 410 ||
      !(await (await fetch(`${base}/fmi/mine`, { headers: owner })).text()).includes("Cancelled")) {
      throw new Error("creator cancellation did not close link and move to history");
    }
    await cancelled.body?.cancel();
    await closedLink.body?.cancel();
  } finally {
    // The test owns this child; a hard stop avoids waiting for HTTP keep-alive.
    child.kill("SIGKILL");
    await child.status;
    await Deno.remove(dir, { recursive: true });
  }
});
