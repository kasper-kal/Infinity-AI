/**
 * Heuristic detection: does this message ask about Infinity's own source code?
 * Used to show the "Use code for this answer?" confirmation card before the
 * message is sent. Kept deliberately conservative, a false positive only
 * shows a card the user can dismiss with one tap.
 */

const EN_PATTERNS = [
  /\byour\s+(own\s+)?(code|source|codebase|repo(?:sitory)?|files|architecture|system\s+prompt|implementation)\b/i,
  /\bsource\s+code\b/i,
  /\b(how|what)\s+(are|were|is)\s+you\s+(built|made|created|programmed|written|coded)\b/i,
  /\b(built|created|made|programmed|coded)\s+you\b/i,
  // "what would you like to add to yourself", "improve yourself", ...
  /\b(add|improve|change|update|upgrade|fix|modify|build|design)\b[\s\S]*\b(yourself|your\s+self)\b/i,
  /\b(yourself|your\s+self)\b[\s\S]*\b(add|improve|change|update|upgrade|fix|modify|build|design)\b/i,
  /\bwhat\s+(would|do|should)\s+you\s+(like\s+to|want\s+to|suggest\s+to)\s+(add|improve|change|upgrade)\b/i,
  /\bread\s+(your|my|the)\s+code\b/i,
  /\bwhat\s+code\s+(are\s+you|do\s+you|makes\s+you)\b/i,
  /\bshow\s+me\s+your\s+(code|source|files|repo(?:sitory)?)\b/i,
];

const NL_PATTERNS = [
  /\b(je|jouw)\s+(eigen\s+)?(code|broncode|bestanden|repo(?:sitory)?|architectuur|implementatie)\b/i,
  /\bbroncode\b/i,
  /\bhoe\s+ben\s+je\s+(gebouwd|gemaakt|geprogrammeerd|gecodeerd)\b/i,
  /\b(gebouwd|gemaakt|geprogrammeerd|gecodeerd)\s+(jou|je)\b/i,
  // Dutch verb stems with optional suffixes: verbeter(en/d), toevoeg(en/d),
  // verander(en/d), pas aan / aanpas(sen/te), upgrade(en/d), fix(en/d)
  // e.g. "verbeter jezelf", "wat zou je aan jezelf willen toevoegen?"
  /\b(verbeter|toevoeg|verander|aanpas|upgrade|fix)[\w]*\b[\s\S]*\b(jezelf|je\s+zelf)\b/i,
  /\b(jezelf|je\s+zelf)\b[\s\S]*\b(verbeter|toevoeg|verander|aanpas|upgrade|fix)[\w]*\b/i,
  /\bwat\s+zou\s+je\b[\s\S]*\b(toevoeg|verbeter|verander|aanpas)[\w]*\b/i,
  /\blees\s+(je|jouw)\s+code\b/i,
  /\bwelke\s+code\b/i,
  /\blaat\s+me\s+(je|jouw)\s+(code|broncode|bestanden)\s+zien\b/i,
];

export function looksLikeCodeRequest(text: string): boolean {
  const t = text.trim();
  if (EN_PATTERNS.some((re) => re.test(t))) return true;
  return NL_PATTERNS.some((re) => re.test(t));
}
