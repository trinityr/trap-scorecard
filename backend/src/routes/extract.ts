import { Router, Request, Response } from "express";
import { requireAuth, requireApprovedTeam } from "../auth";
import { getSetting } from "../settings";

const router = Router();
router.use(requireAuth);
router.use(requireApprovedTeam);

const EXTRACT_PROMPT = `You are reading a handwritten trap shooting scoresheet photographed by a phone camera. Each row is one shooter. Typically there are 5 stations (columns), each scored out of 5 (hits out of 5 clay targets), plus a total out of 25. Column headers might read 1-5 or STA 1-STA 5, plus TOTAL or TOT. Read the handwriting carefully, including any cross-outs or corrections, using the corrected value. If a value is illegible or missing, use null rather than guessing. If you can find a date on the sheet, include it as YYYY-MM-DD, otherwise use null. If the sheet shows a yardage or yard line for the round (e.g. "16 YD", "16 YARD LINE", a single number near the top like 16-27), include it as a plain integer; this is one value for the whole sheet, not per shooter — if you can't find one, use null. Respond with ONLY raw JSON and nothing else — no markdown fences, no preamble like "Looking at the image...", no explanation before or after the JSON — matching exactly this schema: {"date": "YYYY-MM-DD or null", "yardage": "integer or null", "shooters": [{"name": "string", "stations": [n,n,n,n,n] each 0-5 or null per entry if unreadable, "total": number or null}]}`;

// The model is asked to respond with raw JSON only, but vision models
// sometimes ignore that and prepend a sentence or two of prose (e.g.
// "Looking at this scoresheet, I can see...") before the JSON, or wrap it
// in a markdown code fence. Stripping fences alone isn't enough — any
// leading prose still makes JSON.parse throw "Unexpected token". Instead,
// pull out the substring between the first "{" and the last "}" and parse
// that, which is robust to both fences and a leading/trailing sentence.
function extractJson(raw: string): any {
  const withoutFences = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("The model's response didn't contain any JSON.");
  }
  const candidate = withoutFences.slice(start, end + 1);
  return JSON.parse(candidate);
}

router.post("/", async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };
  if (!image) {
    return res.status(400).json({ error: "Missing image (base64, no data: prefix)." });
  }

  const apiKey = await getSetting("anthropic_api_key", process.env.ANTHROPIC_API_KEY);
  if (!apiKey) {
    return res.status(500).json({ error: "No Anthropic API key configured. An admin needs to set one in the Admin panel." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
              { type: "text", text: EXTRACT_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "The AI vision request failed." });
    }

    const data: any = await response.json();
    const textBlock = (data.content || []).find((b: any) => b.type === "text");
    if (!textBlock) {
      return res.status(502).json({ error: "No text response from the model." });
    }

    let parsed: any;
    try {
      parsed = extractJson(textBlock.text);
    } catch (parseErr: any) {
      console.error("Could not parse model response as JSON:", textBlock.text);
      return res.status(502).json({
        error: "The model's response wasn't in the expected format. Try again, or enter the scores by hand below.",
      });
    }

    res.json(parsed);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Could not read the scoresheet: " + err.message });
  }
});

export default router;
