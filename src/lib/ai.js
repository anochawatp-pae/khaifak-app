import { extractJSON } from "./jsonRepair";

// Same call shape as the original in-chat version ({ system, prompt, useSearch }),
// so the rest of the app (buildAnalysisPrompt, analyzeLand, AnalysisTab, RecommendedTab)
// needs no changes at all — only this function's internals point at Gemini now
// instead of Claude, via our own Netlify Function (keeps the API key server-side).
export async function callClaude({ system, prompt, useSearch }) {
  const res = await fetch("/.netlify/functions/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, prompt, useSearch }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`bad response from function (status ${res.status})`);
  }

  if (data.error) {
    const msg = typeof data.error === "string" ? data.error : (data.error.message || JSON.stringify(data.error));
    throw new Error(msg);
  }

  const text = data.text || "";
  if (!text.trim()) {
    throw new Error("empty response from model");
  }
  return extractJSON(text);
}
