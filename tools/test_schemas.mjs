// Self-check for the Crystal Worker's payload contracts (news, markets,
// holdings). Imports the exact validators the Worker runs, feeds them a good
// fixture and a set of deliberately broken ones, and asserts each break is
// caught with an error that names the field. No network, no state.
//
//     node tools/test_schemas.mjs
import { validateNews, validateMarkets, validateHoldings } from "../worker/src/validate.js";
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

console.log("test_schemas: all assertions passed");
