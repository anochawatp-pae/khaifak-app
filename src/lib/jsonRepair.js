// Parses JSON out of a model's text reply, and — if the reply was cut off
// mid-stream (hit a token limit) — repairs it by cutting back to the last
// fully-closed array element / object field instead of failing outright.
export function tryRepairJSON(str) {
  let stack = [];
  let inStr = false, esc = false;
  let bestCut = -1, bestStack = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch); continue; }
    if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) {
        try { return JSON.parse(str.slice(0, i + 1)); } catch { return null; }
      }
      if (stack[stack.length - 1] === "[" || stack.length === 1) {
        bestCut = i;
        bestStack = stack.slice();
      }
    }
  }
  if (bestCut === -1) return null;
  let repaired = str.slice(0, bestCut + 1);
  for (let i = bestStack.length - 1; i >= 0; i--) {
    repaired += bestStack[i] === "{" ? "}" : "]";
  }
  try { return JSON.parse(repaired); } catch { return null; }
}

export function extractJSON(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no json found in response");
  const result = tryRepairJSON(text.slice(start));
  if (result === null) throw new Error("could not parse or repair JSON");
  return result;
}
