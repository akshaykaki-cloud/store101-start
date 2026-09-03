// Store101 questionnaire — AI routing.
// Reads the visitor's business profile + their described struggle, then routes to
// the best-fit existing tool (OnHand / Signal / Shopmind) or flags a custom build.
// Returns structured JSON the frontend renders. Set ANTHROPIC_API_KEY in Vercel.

const TOOLS = {
  onhand: {
    name: "OnHand",
    url: "https://onhand-demo.vercel.app/app.html",
    blurb: "an AI assistant that answers any question about your stock — what's on hand, what's low, where it is — grounded in your real inventory.",
    fits: "inventory, stock levels, 'do we have this', reordering, warehouse, products on shelves, staff/customers asking what's in stock",
  },
  signal: {
    name: "Signal",
    url: "https://signal-app-red-theta.vercel.app/",
    blurb: "an AI analyst that reads your sales numbers and hands back a plain-English report — what's growing, what's slipping, and what to do about it.",
    fits: "understanding sales, not knowing how the business is doing, drowning in numbers/spreadsheets, no time to analyze data, reporting, trends",
  },
  shopmind: {
    name: "Shopmind",
    url: "https://shopmind-gamma.vercel.app/",
    blurb: "a personal AI advisor that knows your shop and gives practical sales & marketing advice grounded in your own products and goals.",
    fits: "marketing, getting more customers, growth advice, decisions about running the shop, promotions, general 'how do I grow' questions",
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const profile = {
      type: (body.type || "").toString().slice(0, 80),
      size: (body.size || "").toString().slice(0, 80),
      struggle: (body.struggle || "").toString().slice(0, 2000),
      name: (body.name || "").toString().slice(0, 120),
    };
    if (!profile.struggle.trim()) return res.status(400).json({ error: "No struggle described." });

    const system = buildPrompt();
    const userMsg =
      `Business type: ${profile.type || "unspecified"}\n` +
      `Business size: ${profile.size || "unspecified"}\n` +
      `Owner name: ${profile.name || "unspecified"}\n` +
      `What they're struggling with (their words): "${profile.struggle}"\n\n` +
      `Return ONLY the JSON object.`;

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!apiRes.ok) {
      const t = await apiRes.text();
      return res.status(502).json({ error: "Routing service error.", detail: t.slice(0, 300) });
    }

    const data = await apiRes.json();
    let text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    text = text.replace(/```json|```/g, "").trim();

    let parsed;
    try { parsed = JSON.parse(text); } catch (e) {
      return res.status(200).json({
        match: "custom",
        tool: null,
        reason: "We'd love to understand your situation better and build the right thing for you.",
        summary: profile.struggle.slice(0, 300),
      });
    }

    // attach tool details for a matched route
    const key = (parsed.match || "").toLowerCase();
    if (TOOLS[key]) {
      parsed.tool = { key, name: TOOLS[key].name, url: TOOLS[key].url, blurb: TOOLS[key].blurb };
      parsed.match = key;
    } else {
      parsed.match = "custom";
      parsed.tool = null;
    }
    if (!parsed.reason) parsed.reason = "";
    if (!parsed.summary) parsed.summary = profile.struggle.slice(0, 300);

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "Unexpected error.", detail: String(err && err.message || err).slice(0, 300) });
  }
}

function buildPrompt() {
  const toolLines = Object.entries(TOOLS)
    .map(([k, t]) => `- "${k}" (${t.name}): ${t.blurb} Good fit when the struggle involves: ${t.fits}.`)
    .join("\n");

  return `You are the routing brain for Store101, which builds AI tools for small businesses. A small business owner has described what they're struggling with. Your job: decide whether one of Store101's existing tools clearly fits their problem, or whether it needs a custom build.

Store101's existing tools:
${toolLines}

Rules:
- Match to a tool ONLY if the owner's struggle genuinely fits what that tool does. Don't force a match.
- If the struggle is about inventory/stock -> onhand. About understanding their numbers/sales performance -> signal. About marketing/growth/advice -> shopmind.
- If it doesn't clearly fit any tool (a different problem, a workflow to automate, something custom), use "custom".
- Be warm, specific, and concrete. Speak to the owner directly ("you", "your shop").

Respond with ONLY a JSON object, no markdown, in exactly this shape:
{
  "match": "onhand" | "signal" | "shopmind" | "custom",
  "reason": "1-2 warm sentences telling the owner why this fits THEIR specific struggle, in plain language.",
  "summary": "A crisp one-line summary of their problem, written for the Store101 team to read (used for follow-up)."
}`;
}
