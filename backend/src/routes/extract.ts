import { Router, Request, Response } from "express";

const router = Router();

const EXTRACT_PROMPT = `You are reading a handwritten trap shooting scoresheet photographed by a phone camera. Each row is one shooter. Typically there are 5 stations (columns), each scored out of 5 (hits out of 5 clay targets), plus a total out of 25. Column headers might read 1-5 or STA 1-STA 5, plus TOTAL or TOT. Read the handwriting carefully, including any cross-outs or corrections, using the corrected value. If a value is illegible or missing, use null rather than guessing. If you can find a date on the sheet, include it as YYYY-MM-DD, otherwise use null. Respond with ONLY raw JSON, no markdown fences, no explanation, matching exactly this schema: {"date": "YYYY-MM-DD or null", "shooters": [{"name": "string", "stations": [n,n,n,n,n] each 0-5 or null per entry if unreadable, "total": number or null}]}`;

router.post("/", async (req: Request, res: Response) => {
  const { image } = req.body as { image?: string };
  if (!image) {
    return res.status(400).json({ error: "Missing image (base64, no data: prefix)." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY — set it in .env." });
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

    const clean = textBlock.text
      .trim()
      .replace(/^```json/, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Could not read the scoresheet: " + err.message });
  }
});

export default router;
