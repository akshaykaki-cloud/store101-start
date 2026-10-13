// Redstone AI Solutions — "Start a project" recommendation engine (Vercel serverless function).
// Reads a business profile + the problems they ticked + their own words, and recommends
// one primary Redstone package plus up to two add-ons, with a reason and three free quick wins.
// Set ANTHROPIC_API_KEY in the Vercel project's Environment Variables (never in code).
// If this function fails, start.html falls back to built-in rules, so the page always works.

const PACKAGES = {
  launch: "Launch Site — $899 one-time. 5-page mobile site launched on their domain. For businesses with no site that just need one.",
  care: "Site + Care — $899 + $59/mo. New website plus hosting, backups, security and monthly edits. Default website pick for owners with no site or an outdated one.",
  deploy: "Deploy & Host — $199. They already have a site or design; we put it live with domain, SSL, email, analytics.",
  chat: "AI Chatbot — $499 + $79/mo. Answers customer questions on their website 24/7 (hours, prices, services) and captures leads.",
  call: "AI Call Assistant — $799 + $149/mo. Answers the phone when they're busy or closed, answers questions, books appointments, texts the owner a summary.",
  cal: "Calendar Manager — $299 + $49/mo. Online booking page, reminders that cut no-shows, self-serve rescheduling.",
  mkt: "Marketing Starter — $499/mo. 12 social posts a month, Google Business Profile updates, one promo campaign.",
  seo: "Local SEO — $399/mo. Google Business Profile optimization, listings, review requests, monthly report.",
  auto: "Automation — $349 per workflow. Automates one repetitive task: follow-ups, review requests, invoices, data entry.",
  ugc: "UGC content — $299 per pack. Four short customer-style videos for Reels/TikTok/Shorts.",
  onhand: "OnHand — custom quote. AI floor assistant grounded in a store's real inventory: stock counts, locations, the right product. For retail with stock-tracking pain.",
  signal: "Signal — custom quote. Turns sales data into a plain-English report on what's moving and what to do. For owners who don't understand their numbers.",
  custom: "Custom AI build — quoted. For problems none of the above fit.",
};
const KEYS = Object.keys(PACKAGES);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });

  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const clip = (v, n) => (v == null ? "" : String(v)).slice(0, n);
    const profile = {
      type: clip(b.type, 80),
      size: clip(b.size, 40),
      pains: Array.isArray(b.pains) ? b.pains.slice(0, 12).map((p) => clip(p, 30)) : [],
      details: clip(b.details, 1500),
      business: clip(b.business, 120),
    };
    if (!profile.pains.length && profile.details.trim().length < 3) {
      return res.status(400).json({ error: "Nothing to go on." });
    }

    const userMsg =
      `Business type: ${profile.type || "unspecified"}\n` +
      `Team size: ${profile.size || "unspecified"}\n` +
      `Business name: ${profile.business || "unspecified"}\n` +
      `Problems they ticked: ${profile.pains.join(", ") || "none"}\n` +
      `In their own words: "${profile.details || "(nothing added)"}"\n\n` +
      `Return ONLY the JSON object.`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 800,
        system: buildPrompt(),
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!apiRes.ok) {
      const t = await apiRes.text();
      return res.status(502).json({ error: "Recommendation service error.", detail: t.slice(0, 300) });
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("").trim();
    const parsed = parseJson(text);
    if (!parsed) return res.status(502).json({ error: "Could not parse recommendation." });

    // Validate everything the model returned against the real catalog.
    let primary = String(parsed.primary || "").toLowerCase();
    if (!KEYS.includes(primary)) primary = "custom";
    const addons = (Array.isArray(parsed.addons) ? parsed.addons : [])
      .map((k) => String(k).toLowerCase())
      .filter((k, i, a) => KEYS.includes(k) && k !== primary && a.indexOf(k) === i)
      .slice(0, 2);
    const quick_wins = (Array.isArray(parsed.quick_wins) ? parsed.quick_wins : [])
      .map((w) => clip(w, 160)).filter(Boolean).slice(0, 3);

    return res.status(200).json({
      primary,
      addons,
      reason: clip(parsed.reason, 400),
      quick_wins,
      summary: clip(parsed.summary, 300),
    });
  } catch (err) {
    return res.status(500).json({ error: "Unexpected error.", detail: String((err && err.message) || err).slice(0, 300) });
  }
}

function parseJson(text) {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const tries = [clean];
  const a = clean.indexOf("{"), z = clean.lastIndexOf("}");
  if (a > -1 && z > a) { tries.push(clean.slice(a, z + 1)); tries.push(clean.slice(a, z + 1).replace(/,(\s*[}\]])/g, "$1")); }
  for (const t of tries) { try { return JSON.parse(t); } catch (e) { /* next */ } }
  return null;
}

function buildPrompt() {
  const list = KEYS.map((k) => `- "${k}": ${PACKAGES[k]}`).join("\n");
  return `You are the recommendation engine for Redstone AI Solutions, a Kingston, Ontario company that sets up websites, AI assistants and marketing for small businesses. A small business owner just told us what's slowing them down. Recommend what they should start with.

Packages (use these keys exactly):
${list}

How to decide:
- Pick ONE primary package: the single most direct fix for their biggest problem. Start small — a package, not a custom build, whenever a package genuinely solves it.
- Add up to TWO add-ons only if they clearly address other problems they mentioned. Fewer is better than padding. Never repeat the primary.
- Missed calls → call. Booking back-and-forth / no-shows → cal (or call if they also miss calls). Repeated customer questions → chat. No or outdated website → care (launch if budget-sensitive solo owner; deploy if they already have a site/design). Not found on Google → seo. No time for social → mkt (ugc if they want video). Repetitive admin → auto. Stock tracking (retail) → onhand. Don't understand their numbers → signal. Anything that doesn't fit → custom.
- Use their business type: a salon or clinic lives on bookings and calls; a trades business lives on calls and Google; retail on stock, Google and social.

Writing:
- "reason": 1–2 warm, specific sentences to the owner ("you", "your") explaining why the primary fits THEIR situation. Plain language, no hype, no jargon, no exclamation marks.
- "quick_wins": exactly 3 short, concrete things they can do themselves this week for free that help with their problem (each under 110 characters). Genuinely useful, not a sales pitch.
- "summary": one line for the Redstone team: business type, size, core problems, and the angle to lead with on the follow-up call.

Respond with ONLY this JSON, no markdown:
{"primary":"<key>","addons":["<key>"],"reason":"...","quick_wins":["...","...","..."],"summary":"..."}`;
}
