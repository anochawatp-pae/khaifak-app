// Netlify Function: POST /.netlify/functions/gemini
// Body: { system: string, prompt: string, useSearch: boolean, images?: [{mimeType, data}] }
// Keeps GEMINI_API_KEY server-side only — never sent to the browser.

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "GEMINI_API_KEY is not set in Netlify environment variables" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { system, prompt, useSearch, images } = payload;
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing prompt" }) };
  }

  // Check ai.google.dev/gemini-api/docs/models for the current free-tier model
  // list — model names/availability change over time. Override via the
  // GEMINI_MODEL env var without redeploying code.
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

  const parts = [];
  if (Array.isArray(images)) {
    for (const img of images) {
      if (img && img.mimeType && img.data) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
      }
    }
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: 4096, temperature: 0.4 },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  if (useSearch) {
    // Grounding with Google Search. Gemini does not allow mixing search tools
    // with non-search tools in one request, so this is the only tool we send.
    body.tools = [{ google_search: {} }];
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json();

    if (data.error) {
      return { statusCode: 200, body: JSON.stringify({ error: data.error }) };
    }

    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").join("\n");

    return { statusCode: 200, body: JSON.stringify({ text, finishReason: data.candidates?.[0]?.finishReason }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
