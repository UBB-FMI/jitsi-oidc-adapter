import { landingPage, meetingPage, MeetingStore, meetingState, myMeetingsPage } from "../src/scheduler.ts";

Deno.test("creator meeting list and canonical invite alias", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new MeetingStore(false, `${dir}/meetings.json`);
    await store.init();
    const meeting = await store.create({
      title: "Test meeting",
      creatorSub: "creator-a",
      creatorName: "Creator A",
      startAt: new Date(Date.now() + 3_600_000),
      creatorTimeZone: "Europe/Bucharest",
    });
    if (store.listByCreator("creator-b").length !== 0) {
      throw new Error("creator isolation failed");
    }
    if (store.listByCreator("creator-a")[0]?.id !== meeting.id) {
      throw new Error("meeting missing");
    }
    if (
      !myMeetingsPage([meeting], "https://meet.example").includes(
        `/m/${meeting.id}`,
      )
    ) {
      throw new Error("public meeting link missing");
    }
    if (
      !meetingPage(meeting, "host-jwt").includes(
        "brandingRoomAlias:'m/'+meetingId",
      )
    ) {
      throw new Error("invite alias missing");
    }
    for (
      const html of [meetingPage(meeting), meetingPage(meeting, "host-jwt")]
    ) {
      if (
        html.includes('id="app-tools"') ||
        html.includes("Open in Jitsi app") ||
        html.includes("Copy meeting link")
      ) {
        throw new Error("meeting page still has floating app or copy controls");
      }
    }
    if (store.isOpen(meeting)) {
      throw new Error("scheduled meeting opened too soon");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Prosody census controls early opening and empty-room expiry", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new MeetingStore(true, `${dir}/meetings.json`);
    await store.init();
    const meeting = await store.create({
      title: "Future meeting",
      creatorSub: "creator-a",
      creatorName: "Creator A",
      startAt: new Date(Date.now() + 3_600_000),
      creatorTimeZone: "UTC",
    });
    const room = `_fmi_${meeting.room}`;
    await store.reconcileCensus(new Map([[room, 1]]));
    if (
      !store.isOpen(meeting) || !meeting.hasEverJoined || meeting.lastEmptyAt
    ) {
      throw new Error("live participant did not open meeting");
    }
    await store.reconcileCensus(new Map());
    if (!meeting.lastEmptyAt) throw new Error("empty time not recorded");
    const firstEmptyAt = meeting.lastEmptyAt;
    const restartedStore = new MeetingStore(true, `${dir}/meetings.json`);
    await restartedStore.init();
    await restartedStore.reconcileCensus(new Map());
    if (restartedStore.get(meeting.id)?.lastEmptyAt !== firstEmptyAt) {
      throw new Error("restart reset empty-room expiry");
    }
    await store.reconcileCensus(new Map([[room, 1]]));
    if (meeting.lastEmptyAt) {
      throw new Error("returning participant did not clear empty time");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("meeting list separates live, upcoming, available, and compact history", () => {
  const base = {
    room: "0123456789abcdef0123456789abcdef",
    accessSecret: "access",
    hostSecret: "host",
    creatorSub: "creator-a",
    creatorName: "Creator A",
    createdAt: "2026-09-21T08:00:00.000Z",
    creatorTimeZone: "Europe/Bucharest",
    hasEverJoined: false,
  };
  const now = Date.parse("2026-09-21T12:00:00.000Z");
  const live = { ...base, id: "111111111111", title: "Live", startAt: "2026-09-21T10:00:00.000Z", activeCount: 2 };
  const future = { ...base, id: "222222222222", title: "Future", startAt: "2026-09-22T10:00:00.000Z", activeCount: 0 };
  const open = { ...base, id: "333333333333", title: "Open", startAt: "2026-09-21T10:00:00.000Z", activeCount: 0 };
  const finished = { ...base, id: "444444444444", title: "Finished", startAt: "2026-09-17T10:00:00.000Z", finishedAt: "2026-09-18T10:00:00.000Z", activeCount: 0 };
  const unknown = { ...base, id: "555555555555", title: "Unknown", startAt: "2026-09-21T10:00:00.000Z", activeCount: null };
  for (const [meeting, expected] of [[live, "live"], [future, "upcoming"], [open, "open"], [finished, "finished"], [unknown, "unknown"]] as const) {
    if (meetingState(meeting, now) !== expected) throw new Error(`wrong ${expected} status`);
  }
  const html = myMeetingsPage([finished, future, open, live, unknown], "https://meet.example");
  if (!html.includes("<details class=\"history-group\">") ||
      !html.includes("In progress") || !html.includes("Starts in ") ||
      !html.includes("2 people in the meeting") ||
      !html.includes("Status unavailable") ||
      !html.includes("data-time=\"2026-09-22T10:00:00.000Z\"")) {
    throw new Error("meeting list status or local time missing");
  }
  if (!landingPage().includes("class=\"history-shortcut\"")) {
    throw new Error("home page shortcut missing");
  }
});

Deno.test("never-started meetings close seven days after scheduled start", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new MeetingStore(true, `${dir}/meetings.json`);
    await store.init();
    const recent = await store.create({
      title: "Recent unstarted meeting",
      creatorSub: "creator-a",
      creatorName: "Creator A",
      startAt: new Date(Date.now() - 9 * 60 * 60 * 1000),
      creatorTimeZone: "UTC",
    });
    const meeting = await store.create({
      title: "Missed meeting",
      creatorSub: "creator-a",
      creatorName: "Creator A",
      startAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      creatorTimeZone: "UTC",
    });
    await store.sweep();
    if (recent.finishedAt || !store.isOpen(recent)) throw new Error("recent meeting closed early");
    if (!meeting.finishedAt || store.isOpen(meeting)) throw new Error("missed meeting still open");
    if (meetingState(store.listByCreator("creator-a").find((item) => item.id === meeting.id)!) !== "finished") {
      throw new Error("missed meeting not in history");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("live meetings cannot be cancelled", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new MeetingStore(true, `${dir}/meetings.json`);
    await store.init();
    const meeting = await store.create({
      title: "Live meeting",
      creatorSub: "creator-a",
      creatorName: "Creator A",
      startAt: new Date(Date.now() - 60_000),
      creatorTimeZone: "UTC",
    });
    await store.reconcileCensus(new Map([[`_fmi_${meeting.room}`, 2]]));
    if (store.listByCreator("creator-a")[0].activeCount !== 2 ||
      await store.cancel(meeting) !== "active" || meeting.finishedAt) {
      throw new Error("live meeting was cancelled or hidden");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
