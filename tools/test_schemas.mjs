// Self-check for the Crystal Worker's payload contracts (news, markets,
// holdings, brief v2, listen, career, feedback). Imports the exact validators
// the Worker runs, feeds them a good fixture and a set of deliberately broken
// ones, and asserts each break is caught with an error that names the field.
// Fixture values are fake on purpose. No network, no state.
//
//     node tools/test_schemas.mjs
import {
  validateNews,
  validateMarkets,
  validateHoldings,
  validateBriefV2,
  validateListen,
  validateCareer,
  validateShopping,
  validateFeedback,
  ID_RE,
} from "../worker/src/validate.js";
import assert from "node:assert";

const story = (over = {}) => ({
  id: "chips-export-rule",
  cat: "ai",
  rank: 1,
  headline: "New export rule hits AI chips",
  oneLiner: "Commerce tightened AI chip exports to three more countries.",
  facts: ["Rule published Friday", "Covers H200-class and above"],
  context: "Third tightening this year.",
  whyItMatters: "IVES basket names ship these chips.",
  score: 78,
  scoreDetail: { reliability: 85, charge: 40, reasoning: "Two wire services, primary document linked." },
  sources: [{ name: "Reuters", note: "primary" }, { name: "FT", note: "" }],
  sourceCount: 4,
  crossSector: true,
  contested: false,
  interpretations: [],
  tickerTags: ["NVDA"],
  ...over,
});

const goodNews = {
  date: "2026-08-08",
  built: "2026-08-08T06:30:00",
  stories: [story()],
  notShownCount: 3,
};

assert.equal(validateNews(goodNews), null, "good news payload must pass");
assert.match(validateNews({ ...goodNews, date: "nope" }), /date/);
assert.match(validateNews({ ...goodNews, stories: "x" }), /stories/);
assert.match(validateNews({ ...goodNews, stories: [story({ id: "BAD ID" })] }), /id/);
assert.match(validateNews({ ...goodNews, stories: [story(), story()] }), /duplicate/);
assert.match(validateNews({ ...goodNews, stories: [story({ score: 0 })] }), /score/);
assert.match(validateNews({ ...goodNews, stories: [story({ scoreDetail: { reliability: 85 } })] }), /charge/);
assert.match(
  validateNews({ ...goodNews, stories: [story({ scoreDetail: { reliability: 85, charge: 40, reasoning: "" } })] }),
  /reasoning/,
);
assert.match(validateNews({ ...goodNews, stories: [story({ sources: [] })] }), /sources/);
assert.match(validateNews({ ...goodNews, stories: [story({ contested: true })] }), /interpretations/);
assert.match(validateNews({ ...goodNews, stories: [story({ tickerTags: [1] })] }), /tickerTags/);
// the category set is closed: an unknown one falls out of the app's label
// table and renders as raw payload text
assert.equal(validateNews({ ...goodNews, stories: [story({ cat: "Aerospace/Defense" })] }), null,
  "the long labels the pipeline writes are legal");
assert.match(validateNews({ ...goodNews, stories: [story({ cat: "Gardening" })] }), /cat/);

const goodMarkets = {
  date: "2026-08-08",
  built: "2026-08-08T17:45:00",
  sections: [
    { id: "breakers", title: "Closes vs breakers", md: "- **VTI** held." },
    { id: "read", title: "Tonight's read", md: "Curriculum unit 4." },
  ],
};
assert.equal(validateMarkets(goodMarkets), null, "good markets payload must pass");
assert.match(validateMarkets({ ...goodMarkets, sections: [] }), /sections/);
assert.match(validateMarkets({ ...goodMarkets, sections: [{ id: "x", md: "y" }] }), /title/);
assert.match(validateMarkets({ ...goodMarkets, built: 5 }), /built/);
// the ticker grid is the surface of this tab; a bad symbol renders as a chip
assert.equal(
  validateMarkets({ ...goodMarkets, tickers: [{ ticker: "VTI", status: "HOLDING", close: 291.4 }] }),
  null,
  "a tickers array is optional and legal",
);
assert.match(validateMarkets({ ...goodMarkets, tickers: "VTI" }), /tickers/);
assert.match(validateMarkets({ ...goodMarkets, tickers: [{ ticker: "not a symbol" }] }), /tickers\[0\]\.ticker/);

const goodHoldings = {
  asOf: "2026-08-08T17:45:00",
  cash: [{ name: "SWVXX", amount: 400, earmark: "Float, no gates" }],
  positions: [
    {
      ticker: "TOST",
      lots: [
        { shares: 25.5, basis: 750, fillDate: "2026-07-28", ltcgDate: "2027-07-29", verified: true },
        { shares: 21.4, basis: 750, fillDate: "2026-08-05", ltcgDate: "2027-08-06", verified: false },
      ],
      breakers: [{ text: "Location adds under 5,000 a quarter", status: "HOLDING, 9,500 last print" }],
      rules: ["One add per name per quarter"],
      nextEvent: { date: "2026-11-04", label: "Q3 earnings", gate: "Bar: gross-profit guide held" },
    },
  ],
};
assert.equal(validateHoldings(goodHoldings), null, "good holdings payload must pass");
assert.match(validateHoldings({ ...goodHoldings, asOf: "" }), /asOf/);
assert.match(
  validateHoldings({ ...goodHoldings, cash: [{ name: "SWVXX", amount: "x" }] }),
  /amount/,
);
const brokenLot = JSON.parse(JSON.stringify(goodHoldings));
brokenLot.positions[0].lots[0].shares = 0;
assert.match(validateHoldings(brokenLot), /shares/);
const brokenLtcg = JSON.parse(JSON.stringify(goodHoldings));
brokenLtcg.positions[0].lots[1].ltcgDate = "next year";
assert.match(validateHoldings(brokenLtcg), /ltcgDate/);
const brokenVerified = JSON.parse(JSON.stringify(goodHoldings));
delete brokenVerified.positions[0].lots[0].verified;
assert.match(validateHoldings(brokenVerified), /verified/);
const brokenTicker = JSON.parse(JSON.stringify(goodHoldings));
brokenTicker.positions[0].ticker = "toast!";
assert.match(validateHoldings(brokenTicker), /ticker/);
const brokenBreaker = JSON.parse(JSON.stringify(goodHoldings));
brokenBreaker.positions[0].breakers = [{ text: "x" }];
assert.match(validateHoldings(brokenBreaker), /status/);

// ---------- id bound: 1 to 40 chars, lowercase, shared everywhere ----------
assert.ok(ID_RE.test("q1"), "a question id is legitimately two chars");
assert.ok(ID_RE.test("a"), "one char is the floor");
assert.ok(!ID_RE.test(""), "empty must fail");
assert.ok(ID_RE.test("sleep-lights-out"));
assert.ok(ID_RE.test("a".repeat(40)), "40 chars is the ceiling");
assert.ok(!ID_RE.test("a".repeat(41)), "41 chars must fail, the old bound was 41 inclusive");
assert.ok(!ID_RE.test("-leading-dash"));
assert.ok(!ID_RE.test("Has-Caps"));
assert.ok(!ID_RE.test("has spaces"));

// ---------- brief v2 ----------
const tl = (over = {}) => ({
  id: "sleep-lights-out",
  t: "night",
  label: "Lights out",
  tier: "floor",
  kind: "task",
  section: "Floor",
  floor: true,
  state: false,
  ...over,
});

const goodBrief = {
  v: 2,
  date: "2026-08-08",
  day: "Saturday",
  strap: "One block tonight.",
  built: "2026-08-08T06:30:00",
  scoreboard: [{ label: "Done", value: 3 }],
  timeline: [tl({ id: "paper-of-the-day", t: "evening", tier: "spine", floor: false }), tl()],
  reward: {
    heldWindow: [
      { d: "2026-08-06", held: true },
      { d: "2026-08-07", held: null },
      { d: "2026-08-08", held: false },
    ],
    weeklyLive: false,
    weeklyCountdown: 2,
    monthlyCountdown: 6,
    outstanding: {
      id: "weekly-courts",
      kind: "weekly",
      pick: "Saturday 2pm, Ben, the courts",
      issued: "2026-08-05",
      expires: "2026-08-12",
    },
    procurement: "Text Ben tonight.",
    dailyPick: "The Bear, one episode",
    dailyAlt: ["A chapter of Zebras"],
    fullPick: "70mm screening downtown",
  },
  scanThumb: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==",
  feedbackNote: "3 recorded, 0 graded, transcriber last ran Aug 5.",
};

assert.equal(validateBriefV2(goodBrief), null, "good brief v2 payload must pass");
assert.equal(validateBriefV2({ ...goodBrief, reward: undefined, scanThumb: undefined }), null);
assert.match(validateBriefV2({ ...goodBrief, v: 1 }), /v must be 2/);
assert.match(validateBriefV2({ ...goodBrief, date: "tomorrow" }), /date/);
assert.match(validateBriefV2({ ...goodBrief, day: "" }), /day/);
assert.match(validateBriefV2({ ...goodBrief, built: 5 }), /built/);
assert.match(validateBriefV2({ ...goodBrief, timeline: "x" }), /timeline/);
assert.match(validateBriefV2({ ...goodBrief, timeline: [tl({ id: "NOPE" })] }), /id/);
assert.match(validateBriefV2({ ...goodBrief, timeline: [tl(), tl()] }), /duplicate/);
assert.match(validateBriefV2({ ...goodBrief, timeline: [tl({ t: "lunch" })] }), /\.t must/);
assert.match(validateBriefV2({ ...goodBrief, timeline: [tl({ label: "  " })] }), /label/);
assert.match(validateBriefV2({ ...goodBrief, timeline: [tl({ tier: "bonus" })] }), /tier/);
assert.match(validateBriefV2({ ...goodBrief, timeline: [tl({ floor: "yes" })] }), /floor/);
assert.match(
  validateBriefV2({ ...goodBrief, timeline: Array.from({ length: 41 }, (_, i) => tl({ id: `item-${i}` })) }),
  /timeline/,
);
assert.match(validateBriefV2({ ...goodBrief, scanThumb: "data:image/png;base64,AAAA" }), /scanThumb/);
assert.match(
  validateBriefV2({ ...goodBrief, scanThumb: "data:image/jpeg;base64," + "A".repeat(41000) }),
  /40KB/,
);
// groups: one row holding children (Morning routine > Supplements)
const grp = (over = {}) => ({
  id: "morning-routine", t: "dawn", label: "Morning routine", tier: "spine",
  kind: "group",
  children: [
    { id: "body-weigh", label: "Weigh in", kind: "task", state: false },
    { id: "supplements", label: "Supplements", kind: "group",
      children: [{ id: "supp-creatine", label: "creatine 5 g", kind: "task" }] },
  ],
  ...over,
});
assert.equal(validateBriefV2({ ...goodBrief, timeline: [tl(), grp()] }), null,
  "a nested group must pass");
assert.match(validateBriefV2({ ...goodBrief, timeline: [grp({ children: [] })] }), /children/);
assert.match(validateBriefV2({ ...goodBrief, timeline: [tl({ children: [] })] }), /children only/);
assert.match(
  validateBriefV2({ ...goodBrief, timeline: [tl(), grp({ children: [{ id: (tl()).id, label: "dup" }] })] }),
  /duplicate/,
);
const tooDeep = grp();
tooDeep.children[1].children[0] = { id: "supp-deep", label: "x", kind: "group",
  children: [{ id: "supp-deeper", label: "y" }] };
assert.match(validateBriefV2({ ...goodBrief, timeline: [tooDeep] }), /nest/);

const brokenWindow = JSON.parse(JSON.stringify(goodBrief));
brokenWindow.reward.heldWindow[0].d = "Wednesday";
assert.match(validateBriefV2(brokenWindow), /heldWindow\[0\]\.d/);
const brokenHeld = JSON.parse(JSON.stringify(goodBrief));
brokenHeld.reward.heldWindow[1].held = "maybe";
assert.match(validateBriefV2(brokenHeld), /held/);
const brokenGrant = JSON.parse(JSON.stringify(goodBrief));
brokenGrant.reward.outstanding.pick = "";
assert.match(validateBriefV2(brokenGrant), /outstanding\.pick/);
const brokenExpiry = JSON.parse(JSON.stringify(goodBrief));
brokenExpiry.reward.outstanding.expires = "soon";
assert.match(validateBriefV2(brokenExpiry), /expires/);

// ---------- listen ----------
const ep = (over = {}) => ({
  id: "acquired-tsmc",
  tags: ["tech-founders"],
  show: "Acquired",
  title: "TSMC, part one",
  note: "Long one, split it over two commutes.",
  length: 212,
  link: "https://example.com/acquired-tsmc",
  kind: "podcast",
  ...over,
});

const goodListen = {
  built: "2026-08-08T06:30:00",
  queue: [ep(), ep({ id: "zebras-ch4", show: "Zebras", title: "Chapter 4", kind: "audiobook", length: "48m" })],
  history: [{ id: "acquired-nvidia", title: "Nvidia, part three", at: "2026-08-01" }],
  music: [{ label: "Deep work", link: "https://example.com/playlist" }],
  audiobook: {
    current: "Why Zebras Do Not Get Ulcers",
    where: ["Libby", "Spotify", "Audible"],
    activities: ["gym", "commute", "chores"],
  },
};

assert.equal(validateListen(goodListen), null, "good listen payload must pass");
assert.equal(validateListen({ built: "x", queue: [] }), null, "an empty queue is legal");
assert.match(validateListen({ ...goodListen, built: 5 }), /built/);
assert.match(validateListen({ ...goodListen, queue: "x" }), /queue/);
assert.match(validateListen({ ...goodListen, queue: [ep({ id: "NO" })] }), /id/);
assert.match(validateListen({ ...goodListen, queue: [ep(), ep()] }), /duplicate/);
assert.match(validateListen({ ...goodListen, queue: [ep({ tags: [1] })] }), /tags/);
assert.match(validateListen({ ...goodListen, queue: [ep({ show: 5 })] }), /show/);
assert.equal(validateListen({ ...goodListen, queue: [ep({ show: undefined })] }), null,
  "show is optional; the pipeline folds it into title");
assert.match(validateListen({ ...goodListen, queue: [ep({ link: "http://example.com" })] }), /link/);
assert.match(validateListen({ ...goodListen, queue: [ep({ kind: "video" })] }), /kind/);
assert.match(
  validateListen({ ...goodListen, queue: Array.from({ length: 101 }, (_, i) => ep({ id: `ep-${i}` })) }),
  /queue/,
);
assert.match(validateListen({ ...goodListen, history: [{ id: "X", title: "y" }] }), /history\[0\]\.id/);
assert.match(validateListen({ ...goodListen, music: [{ label: "x", link: "spotify:uri" }] }), /music\[0\]\.link/);
assert.match(validateListen({ ...goodListen, audiobook: { current: "", where: [], activities: [] } }), /current/);
assert.match(
  validateListen({ ...goodListen, audiobook: { current: "Behave", where: "Libby", activities: [] } }),
  /where/,
);

// ---------- career ----------
const co = (over = {}) => ({
  rank: 1,
  name: "Ursa Major",
  facet: "Hadley engine test cadence",
  text: "Small team, they publish hotfire cadence in press notes.",
  ...over,
});

const goodCareer = {
  built: "2026-08-08T06:30:00",
  spotlight: co(),
  roster: [co(), co({ rank: 2, name: "Agile Space" })],
  outreach: { name: "Jane Doe", body: "Short note about the annulus work.", tickId: "outreach-jane-doe" },
  signals: { date: "2026-08-08", items: ["Two new test-stand roles posted."] },
  aeroDated: "Week of Aug 3",
};

assert.equal(validateCareer(goodCareer), null, "good career payload must pass");
assert.equal(validateCareer({ built: "x", roster: [] }), null, "an empty roster is legal");
assert.match(validateCareer({ ...goodCareer, built: 5 }), /built/);
assert.match(validateCareer({ ...goodCareer, roster: "x" }), /roster/);
assert.match(validateCareer({ ...goodCareer, roster: [co({ rank: "one" })] }), /rank/);
assert.match(validateCareer({ ...goodCareer, roster: [co({ name: " " })] }), /name/);
assert.match(validateCareer({ ...goodCareer, roster: [co({ facet: "" })] }), /facet/);
assert.match(validateCareer({ ...goodCareer, spotlight: co({ text: 12 }) }), /spotlight\.text/);
assert.match(
  validateCareer({ ...goodCareer, roster: Array.from({ length: 41 }, () => co()) }),
  /roster/,
);
assert.match(
  validateCareer({ ...goodCareer, outreach: { name: "Jane", body: "x", tickId: "NOPE" } }),
  /tickId/,
);
assert.match(validateCareer({ ...goodCareer, signals: { date: "friday", items: [] } }), /signals\.date/);
assert.match(
  validateCareer({ ...goodCareer, signals: { date: "2026-08-08", items: [7] } }),
  /signals\.items/,
);

// ---------- feedback ----------
const goodFeedback = {
  date: "2026-08-08",
  items: [
    {
      qid: "roundtable-hardest-call",
      transcriptExcerpt: "The hardest call was cutting the second annulus sweep.",
      grade: "B, the number is missing",
      workshop: "Name the margin you bought, in percent.",
      bestAnswerRef: "Interview-Prep/Best-Answers.md#roundtable-hardest-call",
    },
  ],
};

assert.equal(validateFeedback(goodFeedback), null, "good feedback payload must pass");
assert.match(validateFeedback({ ...goodFeedback, date: "" }), /date/);
assert.match(validateFeedback({ ...goodFeedback, items: "x" }), /items/);
assert.match(validateFeedback({ date: "2026-08-08", items: [{ qid: "BAD QID" }] }), /qid/);
// a transcript the grader could not grade is a real state, not a broken payload
assert.equal(
  validateFeedback({
    ...goodFeedback,
    ran: "2026-08-08T07:10:00",
    items: [{ ...goodFeedback.items[0], grade: null, ran: "2026-08-08T07:10:00" }],
  }),
  null,
  "grade null and a ran stamp must both pass",
);
assert.match(validateFeedback({ ...goodFeedback, ran: 5 }), /ran/);
assert.match(
  validateFeedback({ date: "2026-08-08", items: [{ ...goodFeedback.items[0], grade: {} }] }),
  /grade/,
);
assert.match(
  validateFeedback({ date: "2026-08-08", items: [{ ...goodFeedback.items[0], workshop: 3 }] }),
  /workshop/,
);

// ---------- shopping ----------
const goodShop = {
  built: "2026-08-14T10:00:00-05:00",
  sections: [{
    title: "Supplements, all out or low",
    status: "buy",
    note: "ungated",
    items: [
      { name: "Magnesium glycinate", price: 15, priceText: "~$15",
        desc: "Glycinate only, never oxide.", spec: "200 mg elemental",
        url: "https://www.amazon.com/s?k=magnesium+glycinate" },
      // no price at all: the "free, wear a hat" row must stay legal
      { name: "A brimmed hat and a sleeved shirt" },
    ],
  }],
  totals: [{ label: "Buy now", amount: 15 }],
};
assert.strictEqual(validateShopping(goodShop), null, "the good shopping fixture must pass");
assert.strictEqual(
  validateShopping({ built: "x", sections: [{ title: "t", status: "blocked", items: [] }] }),
  null,
  "an empty section in a legal status is fine",
);
assert.match(validateShopping({ sections: [] }), /built/);
assert.match(validateShopping({ built: "x", sections: {} }), /sections must be an array/);
assert.match(
  validateShopping({ built: "x", sections: [{ title: "t", status: "maybe", items: [] }] }),
  /status must be one of/,
  "an unknown status must be refused, not rendered as an uncoloured row",
);
assert.match(
  validateShopping({ built: "x", sections: [{ title: "", status: "buy", items: [] }] }),
  /title/,
);
assert.match(
  validateShopping({ built: "x", sections: [{ title: "t", status: "buy", items: [{ name: "" }] }] }),
  /name/,
);
assert.match(
  validateShopping({ built: "x", sections: [{ title: "t", status: "buy",
    items: [{ name: "n", price: "15" }] }] }),
  /price must be a number/,
  "a stringy price would break the running total silently",
);
// the href guards: the URL is the one payload value that lands in an attribute
assert.match(
  validateShopping({ built: "x", sections: [{ title: "t", status: "buy",
    items: [{ name: "n", url: "http://x.com" }] }] }),
  /url must be https/,
);
assert.match(
  validateShopping({ built: "x", sections: [{ title: "t", status: "buy",
    items: [{ name: "n", url: 'https://x.com/"onmouseover=alert(1)' }] }] }),
  /quotes, angle brackets or spaces/,
  "a quote in the URL could close the href attribute",
);
assert.match(
  validateShopping({ built: "x", sections: [{ title: "t", status: "buy",
    items: [{ name: "n", url: "javascript:alert(1)" }] }] }),
  /url must be https/,
);
assert.match(
  validateShopping({ built: "x", sections: [{ title: "t", status: "buy", items: [] }],
    totals: [{ label: "x", amount: "5" }] }),
  /amount must be a number/,
);

console.log("test_schemas: all assertions passed");
