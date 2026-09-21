import { MEETING_INACTIVE_HOURS, SCHEDULER_DATA_FILE } from "./config.ts";

export interface Meeting {
  id: string;
  room: string;
  accessSecret: string;
  hostSecret: string;
  title: string;
  creatorSub: string;
  creatorName: string;
  createdAt: string;
  startAt: string;
  creatorTimeZone: string;
  openedAt?: string;
  hasEverJoined: boolean;
  lastEmptyAt?: string;
  finishedAt?: string;
  cancelledAt?: string;
}

export interface MeetingListItem extends Meeting {
  activeCount?: number | null;
}

interface Presence {
  meetingId: string;
  lastSeen: number;
}

const STALE_PRESENCE_MS = 90_000;
const STALE_CENSUS_MS = 120_000;
const INACTIVE_MS = MEETING_INACTIVE_HOURS * 60 * 60 * 1000;
const NEVER_STARTED_MS = 7 * 24 * 60 * 60 * 1000;

function randomId(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}

function page(title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#064d7b"><title>${escapeHtml(title)} · FMI Meets</title>
<style>
:root{--fmi:#064d7b;--fmi2:#0874ad;--ink:#153348;--muted:#587181;--paper:#fff;--wash:#eef6fa;--line:#cfe0e9;--ok:#16765b}
*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:linear-gradient(145deg,#e9f4f9,#f8fbfd 52%,#e1eff6);min-height:100vh}
.shell{width:min(960px,calc(100% - 32px));margin:0 auto;padding:36px 0 64px}.brand{display:flex;align-items:center;gap:18px;margin-bottom:32px;color:var(--fmi);text-decoration:none}.brand img{width:88px;height:88px;object-fit:contain}.brand strong{font-size:clamp(24px,4vw,38px);letter-spacing:-.03em}.brand span{display:block;color:var(--muted);font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-top:3px}
.card{background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:22px;padding:clamp(24px,5vw,48px);box-shadow:0 18px 50px rgba(6,77,123,.12)}h1{font-size:clamp(30px,5vw,50px);line-height:1.06;letter-spacing:-.04em;margin:0 0 12px}h2{margin:0 0 10px}p{line-height:1.6}.lead{color:var(--muted);font-size:18px;margin:0 0 30px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:30px}.choice{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:16px;padding:24px;background:#fff}.choice p{color:var(--muted);min-height:52px}.choice>.btn{display:flex;width:100%;margin-top:auto}.btn,button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;border:0;border-radius:11px;padding:0 22px;background:var(--fmi);color:#fff;text-decoration:none;font:inherit;font-weight:750;cursor:pointer}.btn:hover,button:hover{background:var(--fmi2)}.btn.secondary{background:#fff;color:var(--fmi);border:1px solid var(--fmi)}.stack{display:grid;gap:14px}.field{display:grid;gap:7px}[hidden]{display:none!important}.field label{font-weight:700}.field input,.field select{width:100%;min-height:48px;border:1px solid #adc8d7;border-radius:10px;padding:10px 12px;font:inherit;color:var(--ink);background:#fff}.hint,.meta{color:var(--muted);font-size:14px}.modal{width:min(440px,calc(100% - 32px));border:1px solid var(--line);border-radius:18px;padding:0;color:var(--ink);background:#fff;box-shadow:0 24px 80px rgba(7,29,42,.3)}.modal::backdrop{background:rgba(7,29,42,.58);backdrop-filter:blur(3px)}.modal-content{padding:28px}.modal h2{color:var(--fmi);font-size:26px}.modal p{color:var(--muted);margin:10px 0 24px}.modal button{width:100%}.meeting-link{display:flex;gap:9px;align-items:center;background:var(--wash);border:1px solid var(--line);border-radius:12px;padding:10px}.meeting-link input{flex:1;border:0;background:transparent;font:inherit;color:var(--ink);min-width:0}.notice{border-left:4px solid var(--fmi2);padding:13px 16px;background:var(--wash);border-radius:8px}.time{font-weight:800;color:var(--fmi);font-size:20px}.spinner{width:32px;height:32px;border:4px solid var(--line);border-top-color:var(--fmi);border-radius:50%;animation:spin 1s linear infinite;margin:22px auto}@keyframes spin{to{transform:rotate(360deg)}}
.history-shortcut{display:flex;align-items:center;gap:16px;margin-top:24px;padding:18px 20px;border:1px solid var(--line);border-radius:15px;background:var(--wash);color:var(--ink);text-decoration:none}.history-shortcut:hover{border-color:var(--fmi2);background:#e4f2fa}.history-shortcut .shortcut-icon{display:grid;place-items:center;flex:none;width:42px;height:42px;border-radius:12px;background:#d3eaf5;color:var(--fmi);font-size:22px}.history-shortcut strong,.history-shortcut small{display:block}.history-shortcut small{color:var(--muted);margin-top:3px}.history-shortcut .arrow{margin-left:auto;color:var(--fmi);font-size:24px}.meeting-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;flex-wrap:wrap}.meeting-head .lead{margin-bottom:0}.meeting-head .btn{flex:none}.meeting-section{margin-top:32px}.section-head{display:flex;align-items:baseline;gap:10px;margin-bottom:13px}.section-head h2{margin:0;font-size:23px}.count{border-radius:999px;padding:3px 9px;background:#deebf2;color:var(--fmi);font-size:13px;font-weight:800}.meeting-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.meeting-card{min-width:0;border:1px solid var(--line);border-radius:16px;background:#fff;padding:20px}.meeting-card h3{font-size:20px;line-height:1.25;margin:12px 0 8px;overflow-wrap:anywhere}.meeting-card .meeting-link{margin-top:18px}.meeting-card .btn{margin-top:12px;min-height:42px}.meeting-actions{display:flex;gap:9px;flex-wrap:wrap}.meeting-actions .btn{flex:1;padding:0 13px;font-size:14px;white-space:nowrap}.modal #keep-meeting{margin-top:10px}.meeting-card .meta{margin:4px 0;line-height:1.45}.status{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;background:#e8f1f6;color:var(--fmi)}.status.live{background:#dff5eb;color:#126548}.status.live:before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor}.status.upcoming{background:#e6f1fc;color:#155b96}.status.finished,.status.unknown{background:#edf0f2;color:#526876}.status.open{background:#fff3d9;color:#795600}.countdown{font-weight:750;color:var(--fmi)}.history-group{margin-top:30px;border-top:1px solid var(--line);padding-top:20px}.history-group summary{cursor:pointer;color:var(--fmi);font-weight:800}.history-group .meeting-grid{margin-top:17px}.empty-section{color:var(--muted);margin:0}.meeting-card.finished-card{background:#f8fbfd}.meeting-card.finished-card .meeting-link{margin-top:12px}
@media(max-width:680px){.grid,.meeting-grid{grid-template-columns:1fr}.shell{padding-top:20px}.brand img{width:68px;height:68px}.choice p{min-height:0}.card{padding:22px}.meeting-head .btn{width:100%}.meeting-link{min-width:0}.meeting-link button{padding:0 12px}.meeting-card{padding:17px}.history-shortcut{padding:15px}}
</style></head><body><main class="shell"><a class="brand" href="/"><img src="/branding/fmi-logo.png" alt="FMI logo"><div><strong>FMI Meets</strong><span>Facultatea de Matematică și Informatică</span></div></a>${body}</main>${script}</body></html>`;
}

export class MeetingStore {
  #meetings = new Map<string, Meeting>();
  #presence = new Map<string, Presence>();
  #censusCounts = new Map<string, number>();
  #censusAt = 0;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly censusEnabled = false, private readonly dataFile = SCHEDULER_DATA_FILE) {}

  async init(): Promise<void> {
    let migrated = false;
    try {
      const parsed = JSON.parse(await Deno.readTextFile(this.dataFile)) as Meeting[];
      for (const meeting of parsed) {
        if (!meeting.hostSecret) {
          meeting.hostSecret = randomId(24);
          migrated = true;
        }
        this.#meetings.set(meeting.id, meeting);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await this.#persist();
    }
    if (migrated) await this.#persist();
  }

  get(id: string): Meeting | undefined {
    return this.#meetings.get(id.toLowerCase());
  }

  findByInternalRoom(room: string): Meeting | undefined {
    return [...this.#meetings.values()].find((meeting) => `_fmi_${meeting.room}` === room);
  }

  listByCreator(sub: string): MeetingListItem[] {
    const censusFresh = this.censusEnabled && Date.now() - this.#censusAt <= STALE_CENSUS_MS;
    return [...this.#meetings.values()].filter((meeting) => meeting.creatorSub === sub)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((meeting) => ({
        ...meeting,
        activeCount: censusFresh
          ? this.#censusCounts.get(`_fmi_${meeting.room}`) || 0
          : this.censusEnabled ? null : [...this.#presence.values()].filter((presence) => presence.meetingId === meeting.id).length,
      }));
  }

  async create(input: {
    title: string;
    creatorSub: string;
    creatorName: string;
    startAt: Date;
    creatorTimeZone: string;
  }): Promise<Meeting> {
    let id = randomId(6);
    while (this.#meetings.has(id)) id = randomId(6);
    const meeting: Meeting = {
      id,
      room: randomId(16),
      accessSecret: randomId(24),
      hostSecret: randomId(24),
      title: input.title,
      creatorSub: input.creatorSub,
      creatorName: input.creatorName,
      createdAt: new Date().toISOString(),
      startAt: input.startAt.toISOString(),
      creatorTimeZone: input.creatorTimeZone,
      hasEverJoined: false,
    };
    this.#meetings.set(id, meeting);
    await this.#persist();
    return meeting;
  }

  isOpen(meeting: Meeting): boolean {
    if (meeting.finishedAt) return false;
    return Boolean(meeting.openedAt) || Date.now() >= Date.parse(meeting.startAt);
  }

  async openEarly(meeting: Meeting): Promise<void> {
    if (!meeting.openedAt) {
      meeting.openedAt = new Date().toISOString();
      await this.#persist();
    }
  }

  async cancel(meeting: Meeting): Promise<"cancelled" | "finished" | "active" | "unknown"> {
    if (meeting.finishedAt) return "finished";
    if (this.censusEnabled && Date.now() - this.#censusAt > STALE_CENSUS_MS) return "unknown";
    const active = this.censusEnabled
      ? (this.#censusCounts.get(`_fmi_${meeting.room}`) || 0) > 0
      : this.#activeFor(meeting.id);
    if (active) return "active";
    const now = new Date().toISOString();
    meeting.cancelledAt = now;
    meeting.finishedAt = now;
    await this.#persist();
    return "cancelled";
  }

  cookieFor(meeting: Meeting, moderator = false): string {
    const secret = moderator ? meeting.hostSecret : meeting.accessSecret;
    return `fmi_meeting=${meeting.id}.${secret}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`;
  }

  authorizeCookie(cookieHeader: string, internalRoom: string): Meeting | undefined {
    const match = cookieHeader.match(/(?:^|;\s*)fmi_meeting=([a-f0-9]+)\.([a-f0-9]+)/);
    if (!match) return undefined;
    const meeting = this.get(match[1]);
    if (!meeting || `_fmi_${meeting.room}` !== internalRoom || meeting.finishedAt) return undefined;
    if (meeting.hostSecret === match[2]) return meeting;
    return meeting.accessSecret === match[2] && this.isOpen(meeting) ? meeting : undefined;
  }

  async presence(meeting: Meeting, sessionId: string, action: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{12,100}$/.test(sessionId)) throw new Error("invalid session");
    const now = Date.now();
    if (action === "leave") {
      this.#presence.delete(sessionId);
    } else {
      this.#presence.set(sessionId, { meetingId: meeting.id, lastSeen: now });
      if (!meeting.hasEverJoined || meeting.lastEmptyAt) {
        meeting.hasEverJoined = true;
        meeting.lastEmptyAt = undefined;
        await this.#persist();
      }
    }
    if (!this.censusEnabled && !this.#activeFor(meeting.id)) {
      meeting.lastEmptyAt = new Date().toISOString();
      await this.#persist();
    }
  }

  async reconcileCensus(counts: Map<string, number>): Promise<void> {
    if (!this.censusEnabled) return;
    this.#censusCounts = counts;
    this.#censusAt = Date.now();
    let changed = false;
    for (const meeting of this.#meetings.values()) {
      if (meeting.finishedAt) continue;
      const active = (counts.get(`_fmi_${meeting.room}`) || 0) > 0;
      if (active) {
        if (!meeting.hasEverJoined) {
          meeting.hasEverJoined = true;
          changed = true;
        }
        if (!meeting.openedAt && Date.now() < Date.parse(meeting.startAt)) {
          meeting.openedAt = new Date().toISOString();
          changed = true;
        }
        if (meeting.lastEmptyAt) {
          meeting.lastEmptyAt = undefined;
          changed = true;
        }
      } else if (meeting.hasEverJoined && !meeting.lastEmptyAt) {
        meeting.lastEmptyAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  async sweep(): Promise<void> {
    const now = Date.now();
    for (const [session, presence] of this.#presence) {
      if (now - presence.lastSeen > STALE_PRESENCE_MS) this.#presence.delete(session);
    }
    const censusStale = this.censusEnabled && now - this.#censusAt > STALE_CENSUS_MS;
    let changed = false;
    for (const meeting of this.#meetings.values()) {
      if (meeting.finishedAt) continue;
      if (!meeting.hasEverJoined) {
        if (now - Date.parse(meeting.startAt) >= NEVER_STARTED_MS) {
          meeting.finishedAt = new Date().toISOString();
          changed = true;
        }
        continue;
      }
      if (censusStale) continue;
      const active = this.censusEnabled
        ? (this.#censusCounts.get(`_fmi_${meeting.room}`) || 0) > 0
        : this.#activeFor(meeting.id);
      if (active) {
        if (meeting.lastEmptyAt) {
          meeting.lastEmptyAt = undefined;
          changed = true;
        }
        continue;
      }
      if (!meeting.lastEmptyAt) {
        meeting.lastEmptyAt = new Date().toISOString();
        changed = true;
      } else if (now - Date.parse(meeting.lastEmptyAt) >= INACTIVE_MS) {
        meeting.finishedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await this.#persist();
  }

  #activeFor(meetingId: string): boolean {
    for (const presence of this.#presence.values()) {
      if (presence.meetingId === meetingId) return true;
    }
    return false;
  }

  #persist(): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const temporary = `${this.dataFile}.tmp`;
      await Deno.writeTextFile(temporary, JSON.stringify([...this.#meetings.values()], null, 2));
      await Deno.rename(temporary, this.dataFile);
    });
    return this.#writeQueue;
  }
}

export function htmlResponse(body: string, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(body, { status, headers: responseHeaders });
}

export function landingPage(): string {
  return page("Welcome", `<section class="card"><h1>Meetings hosted by our faculty.</h1><div class="grid"><article class="choice"><h2>Join a meeting</h2><p>Paste a meeting link or enter its 12-character code.</p><form id="join" class="stack"><div class="field"><label for="meeting">Meeting link or code</label><input id="meeting" autocomplete="off" required placeholder="https://meet.cs.ubbcluj.ro/m/…"></div><div id="join-error" class="hint" role="alert"></div><button type="submit">Join meeting</button></form></article><article class="choice"><h2>Create a meeting</h2><p>Start now or schedule a link to share. Microsoft login is required to host.</p><a class="btn" href="/fmi/new">Create a meeting</a></article></div><a class="history-shortcut" href="/fmi/mine"><span class="shortcut-icon" aria-hidden="true">▣</span><span><strong>My meetings</strong><small>Find links, upcoming meetings and meetings in progress</small></span><span class="arrow" aria-hidden="true">→</span></a></section>`, `<script>document.getElementById('join').addEventListener('submit',e=>{e.preventDefault();const v=document.getElementById('meeting').value.trim(),valid=new RegExp('^[a-f0-9]{12}$','i');let code=valid.test(v)?v:'';if(!code){try{const u=new URL(v,location.origin),parts=u.pathname.split('/').filter(Boolean);if(parts.length===2&&parts[0]==='m'&&valid.test(parts[1]))code=parts[1]}catch{}}if(code)location.href='/m/'+code.toLowerCase();else document.getElementById('join-error').textContent='Please enter a valid FMI Meets link or code.'})</script>`);
}

export function meetingState(meeting: MeetingListItem, now = Date.now()): "live" | "upcoming" | "open" | "finished" | "unknown" {
  if (meeting.finishedAt) return "finished";
  if (meeting.activeCount === null) return "unknown";
  if ((meeting.activeCount || 0) > 0) return "live";
  if (!meeting.openedAt && now < Date.parse(meeting.startAt)) return "upcoming";
  return "open";
}

export function myMeetingsPage(meetings: MeetingListItem[], publicUrl: string): string {
  const groups: Record<ReturnType<typeof meetingState>, MeetingListItem[]> = { live: [], upcoming: [], open: [], finished: [], unknown: [] };
  for (const meeting of meetings) groups[meetingState(meeting)].push(meeting);
  groups.upcoming.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  groups.open.sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
  groups.finished.sort((a, b) => Date.parse(b.finishedAt || "") - Date.parse(a.finishedAt || ""));
  const card = (meeting: MeetingListItem, state: ReturnType<typeof meetingState>): string => {
    const link = `${publicUrl}/m/${meeting.id}`;
    const labels = { live: "In progress", upcoming: "Upcoming", open: "Available", finished: meeting.cancelledAt ? "Cancelled" : "Finished", unknown: "Status unavailable" };
    const detail = state === "live"
      ? `${meeting.activeCount} ${meeting.activeCount === 1 ? "person" : "people"} in the meeting`
      : state === "upcoming"
      ? `<span class="countdown" data-until="${escapeHtml(meeting.startAt)}" data-prefix="Starts in "></span>`
      : state === "open" && meeting.lastEmptyAt
      ? `<span class="countdown" data-until="${new Date(Date.parse(meeting.lastEmptyAt) + INACTIVE_MS).toISOString()}" data-prefix="Closes in "></span>`
      : state === "open"
      ? `<span class="countdown" data-until="${new Date(Date.parse(meeting.startAt) + NEVER_STARTED_MS).toISOString()}" data-prefix="Closes in "></span>`
      : state === "unknown" ? "Refresh the page in a moment to check live status"
      : meeting.cancelledAt ? "Cancelled by the creator" : "Link closed";
    return `<article class="meeting-card ${state === "finished" ? "finished-card" : ""}"><span class="status ${state}">${labels[state]}</span><h3>${escapeHtml(meeting.title)}</h3><p class="meta">${state === "finished" ? "Was scheduled for" : "Scheduled for"} <time class="local-time" datetime="${escapeHtml(meeting.startAt)}" data-time="${escapeHtml(meeting.startAt)}"></time></p><p class="meta">${detail}</p>${state === "finished" ? "" : `<div class="meeting-link"><input readonly value="${escapeHtml(link)}" aria-label="Meeting link for ${escapeHtml(meeting.title)}"><button type="button" class="copy-link" aria-label="Copy meeting link for ${escapeHtml(meeting.title)}">Copy</button></div><div class="meeting-actions"><a class="btn" href="/m/${meeting.id}">Enter as moderator</a>${state === "live" || state === "unknown" ? "" : `<button type="button" class="btn secondary cancel-meeting" data-id="${meeting.id}" data-title="${escapeHtml(meeting.title)}">Cancel meeting</button>`}</div>`}</article>`;
  };
  const section = (state: "live" | "upcoming" | "open" | "unknown", title: string): string => groups[state].length
    ? `<section class="meeting-section" aria-label="${title}"><div class="section-head"><h2>${title}</h2><span class="count">${groups[state].length}</span></div><div class="meeting-grid">${groups[state].map((meeting) => card(meeting, state)).join("")}</div></section>`
    : "";
  const active = section("live", "In progress") + section("upcoming", "Upcoming") + section("open", "Available now") + section("unknown", "Status unavailable");
  const history = groups.finished.length
    ? `<details class="history-group"><summary>Past meetings (${groups.finished.length})</summary><div class="meeting-grid">${groups.finished.map((meeting) => card(meeting, "finished")).join("")}</div></details>`
    : "";
  const empty = !active && !history ? `<p class="empty-section">No meetings are associated with this Microsoft account yet.</p>` : "";
  return page("My meetings", `<section class="card"><div class="meeting-head"><div><h1>My meetings</h1><p class="lead">Meetings created with your Microsoft account.</p></div><a class="btn" href="/fmi/new">Create a meeting</a></div>${active || (!empty ? `<p class="empty-section meeting-section">No meetings are currently open or upcoming.</p>` : "")}${empty}${history}</section><dialog class="modal" id="cancel-dialog" aria-labelledby="cancel-title"><div class="modal-content"><h2 id="cancel-title">Cancel meeting?</h2><p id="cancel-message"></p><form id="cancel-form" method="post"><button type="submit">Yes, cancel meeting</button></form><button type="button" class="btn secondary" id="keep-meeting">Keep meeting</button></div></dialog>`, timeScript(`for(const b of document.querySelectorAll('.copy-link'))b.onclick=async()=>{try{await navigator.clipboard.writeText(b.previousElementSibling.value);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',2000)}catch{b.textContent='Copy failed'}};const dialog=document.getElementById('cancel-dialog');for(const b of document.querySelectorAll('.cancel-meeting'))b.onclick=()=>{document.getElementById('cancel-message').textContent='This will close the share link for “'+b.dataset.title+'”. Attendees will no longer be able to join.';document.getElementById('cancel-form').action='/fmi/cancel/'+b.dataset.id;dialog.showModal()};document.getElementById('keep-meeting').onclick=()=>dialog.close();function updateCountdowns(){for(const e of document.querySelectorAll('.countdown')){const minutes=Math.max(0,Math.ceil((Date.parse(e.dataset.until)-Date.now())/60000));if(!minutes){e.textContent=e.dataset.prefix==='Starts in '?'Starting now':'Closing soon';continue}const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),mins=minutes%60;e.textContent=e.dataset.prefix+[days?days+'d':null,hours?hours+'h':null,mins?mins+'m':null].filter(Boolean).join(' ')}}updateCountdowns();setInterval(updateCountdowns,60000)`));
}

export function newMeetingPage(): string {
  return page(
    "Create a meeting",
    `<section class="card"><h1>Create a meeting</h1><p class="lead">You will sign in with your UBB Microsoft account before the meeting is created.</p><form class="stack" method="post" action="/fmi/create" id="create" novalidate><div class="field"><label for="title">Meeting title</label><input id="title" name="title" maxlength="120" required placeholder="Department meeting"></div><div class="field"><label for="mode">When</label><select id="mode" name="mode"><option value="now">Start now</option><option value="schedule">Schedule for later</option></select></div><div class="field" id="scheduled" hidden><label for="localStart">Start date and time</label><input id="localStart" type="datetime-local" aria-describedby="zone"><span class="hint" id="zone"></span></div><input type="hidden" name="startIso" id="startIso"><input type="hidden" name="timeZone" id="timeZone"><button type="submit">Continue with Microsoft</button></form></section><dialog class="modal" id="validation-dialog" aria-labelledby="validation-title"><div class="modal-content"><h2 id="validation-title">Check meeting details</h2><p id="validation-message"></p><form method="dialog"><button type="submit">Go back</button></form></div></dialog>`,
    `<script>const form=document.getElementById('create'),title=document.getElementById('title'),mode=document.getElementById('mode'),box=document.getElementById('scheduled'),local=document.getElementById('localStart'),startIso=document.getElementById('startIso'),dialog=document.getElementById('validation-dialog'),message=document.getElementById('validation-message'),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';let errorField;document.getElementById('timeZone').value=zone;document.getElementById('zone').textContent='Your timezone: '+zone;const min=new Date(Date.now()+5*60000);min.setMinutes(min.getMinutes()-min.getTimezoneOffset());local.min=min.toISOString().slice(0,16);function showError(text,field){errorField=field;message.textContent=text;if(typeof dialog.showModal==='function')dialog.showModal();else{alert(text);field.focus()}}function syncMode(){const scheduled=mode.value==='schedule';box.hidden=!scheduled;local.required=scheduled}dialog.addEventListener('close',()=>errorField?.focus());mode.addEventListener('change',syncMode);syncMode();form.addEventListener('submit',e=>{if(!title.value.trim()){e.preventDefault();showError('Enter a meeting title before continuing.',title);return}if(mode.value!=='schedule'){startIso.value='';return}if(!local.value){e.preventDefault();showError('Choose a start date and time before continuing.',local);return}const d=new Date(local.value);if(!Number.isFinite(d.getTime())||d.getTime()<Date.now()){e.preventDefault();showError('Choose a start date and time in the future.',local);return}startIso.value=d.toISOString()})</script>`,
  );
}

export function scheduledCreatedPage(meeting: Meeting, publicUrl: string): string {
  const link = `${publicUrl}/m/${meeting.id}`;
  return page("Meeting scheduled", `<section class="card"><h1>Meeting scheduled</h1><p class="lead">${escapeHtml(meeting.title)}</p><div class="notice"><div>Starts</div><div class="time local-time" data-time="${meeting.startAt}"></div><div class="meta">Scheduled in ${escapeHtml(meeting.creatorTimeZone)}</div></div><p>Share this link with attendees:</p><div class="meeting-link"><input id="link" readonly value="${escapeHtml(link)}"><button id="copy" type="button">Copy</button></div><p><a class="btn" href="/m/${meeting.id}">Enter as moderator</a> <a class="btn secondary" href="/fmi/mine">My meetings</a></p></section>`, timeScript(`document.getElementById('copy').onclick=async()=>{await navigator.clipboard.writeText(document.getElementById('link').value);document.getElementById('copy').textContent='Copied'}`));
}

export function waitingPage(meeting: Meeting): string {
  return page("Waiting for meeting", `<section class="card"><h1>${escapeHtml(meeting.title)}</h1><p class="lead">This meeting has not started yet.</p><div class="notice"><div>Scheduled to start at</div><div class="time local-time" data-time="${meeting.startAt}"></div><div class="meta">Shown in your local timezone: <span id="viewer-zone"></span></div></div><div class="spinner" aria-hidden="true"></div><p style="text-align:center">This page will open automatically when the start time arrives or when the moderator starts early.</p><p style="text-align:center"><a class="btn secondary" href="/fmi/host/${meeting.id}">I am the moderator</a></p></section>`, timeScript(`document.getElementById('viewer-zone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';setInterval(async()=>{try{const r=await fetch('/fmi/status/${meeting.id}',{cache:'no-store'}),s=await r.json();if(s.open)location.reload();if(s.finished)location.reload()}catch{}},10000)`));
}

export function finishedPage(meeting: Meeting): string {
  const reason = meeting.cancelledAt
    ? "This meeting was cancelled by its creator, so its link is now closed."
    : meeting.hasEverJoined
    ? `This meeting has been empty for more than ${MEETING_INACTIVE_HOURS} hours and its link is now closed.`
    : "This meeting was not started within 7 days of its scheduled time, so its link is now closed.";
  return page("Meeting finished", `<section class="card"><h1>Meeting finished</h1><p class="lead">${escapeHtml(meeting.title)}</p><p>${reason}</p><a class="btn" href="/">Return to FMI Meets</a></section>`);
}

export function meetingPage(meeting: Meeting, hostJwt = ""): string {
  const room = `_fmi_${meeting.room}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(meeting.title)} · FMI Meets</title><style>html,body,#meet{height:100%;width:100%;margin:0;background:#071d2a}iframe{display:block}#app-tools{position:fixed;z-index:10;right:12px;bottom:12px;display:flex;gap:8px;background:#fff;color:#064d7b;padding:8px;border-radius:10px;box-shadow:0 4px 25px #0008;font:600 14px system-ui}#app-tools a,#app-tools button{color:#064d7b;background:#eef6fa;border:0;border-radius:6px;padding:8px;text-decoration:none;cursor:pointer}</style></head><body><div id="meet"></div><div id="app-tools"><a href="/fmi/app/${meeting.id}">Open in Jitsi app</a><button id="copy-link" type="button">Copy meeting link</button><button id="dismiss-tools" type="button" aria-label="Dismiss">×</button></div><script src="/external_api.js"></script><script>
const meetingId=${JSON.stringify(meeting.id)},sessionId=crypto.randomUUID().replaceAll('-',''),payload=new URLSearchParams({meetingId,sessionId});let joined=false,timer;if(location.search)history.replaceState(null,'','/m/'+meetingId);
document.getElementById('copy-link').onclick=async()=>{await navigator.clipboard.writeText(location.origin+'/m/'+meetingId);document.getElementById('copy-link').textContent='Copied'};document.getElementById('dismiss-tools').onclick=()=>document.getElementById('app-tools').remove();
const api=new JitsiMeetExternalAPI(location.host,{roomName:${JSON.stringify(room)},parentNode:document.getElementById('meet'),${hostJwt ? `jwt:${JSON.stringify(hostJwt)},` : ""}configOverwrite:{prejoinConfig:{enabled:true},subject:${JSON.stringify(meeting.title)},brandingRoomAlias:'m/'+meetingId},interfaceConfigOverwrite:{APP_NAME:'FMI Meets',PROVIDER_NAME:'FMI UBB',JITSI_WATERMARK_LINK:'https://www.cs.ubbcluj.ro/'}});
async function presence(action){const p=new URLSearchParams(payload);p.set('action',action);try{await fetch('/fmi/presence',{method:'POST',body:p,credentials:'same-origin',keepalive:true})}catch{}}
api.addListener('videoConferenceJoined',()=>{joined=true;presence('join');${hostJwt ? `api.executeCommand('subject',${JSON.stringify(meeting.title)});` : ""}timer=setInterval(()=>presence('heartbeat'),30000)});
function leave(){if(!joined)return;joined=false;clearInterval(timer);const p=new URLSearchParams(payload);p.set('action','leave');navigator.sendBeacon('/fmi/presence',p)}
api.addListener('videoConferenceLeft',leave);api.addListener('readyToClose',()=>{leave();location.href='/'});addEventListener('pagehide',leave);
</script></body></html>`;
}

export function appLaunchPage(meeting: Meeting, publicUrl: string, appUrl: string): string {
  const link = `${publicUrl}/m/${meeting.id}`;
  return page("Open Jitsi app", `<section class="card"><h1>Open in Jitsi Meet</h1><p class="lead">${escapeHtml(meeting.title)}</p><p><a class="btn" href="${escapeHtml(appUrl)}" rel="noreferrer">Open Jitsi Meet app</a></p><p class="hint">If the app does not open, install the official Jitsi Meet app or continue in your browser.</p><p><a class="btn secondary" href="/m/${meeting.id}">Continue in browser</a></p><p>Share only this meeting link:</p><div class="meeting-link"><input id="link" readonly value="${escapeHtml(link)}"><button id="copy" type="button">Copy</button></div></section>`, `<script>document.getElementById('copy').onclick=async()=>{await navigator.clipboard.writeText(document.getElementById('link').value);document.getElementById('copy').textContent='Copied'}</script>`);
}

function timeScript(extra = ""): string {
  return `<script>for(const e of document.querySelectorAll('.local-time'))e.textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'}).format(new Date(e.dataset.time));${extra}</script>`;
}
