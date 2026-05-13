/**
 * Tokenizes card text for fill-in-the-blanks study mode.
 * Non-stop words of 4+ characters become blanks the user must type.
 */

const STOP_WORDS = new Set([
  "the","and","but","or","nor","for","yet","so","a","an",
  "in","on","at","to","of","by","as","up","if","is","are",
  "was","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","may","might","shall","can","must",
  "it","its","this","that","these","those",
  "with","from","into","about","over","under","between","through","within",
  "without","against","along","across","behind","beyond","upon","onto",
  "than","then","when","where","which","who","whom","whose","what","how","why",
  "not","no","any","all","both","each","few","more","most","other","some",
  "such","own","same","too","very","just","also","only","even","still",
  "because","since","unless","although","though","while","after","before",
  "during","however","therefore","thus","hence","whereas","whilst",
  "here","there","around","above","below","following","except","either",
  "every","plus","like","one","two","three","four","five","six",
  "i","me","my","myself","we","our","ours","you","your","yours",
  "he","him","his","she","her","hers","they","them","their","theirs",
  "include","including","another","further","many","much","several","both",
  "type","area","term","case","form","kind","part","side","way","time",
  "used","uses","use","using","made","make","makes","give","given","gives",
  "take","taken","takes","come","comes","came","show","shows","shown",
  "known","found","seen","said","called","named","often","always","never",
]);

export interface FillToken {
  type: "text" | "blank";
  value: string;
  blankIndex: number;
}

/** Strip markdown formatting to plain text for fill-blanks processing. */
export function stripForFill(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gm, "")
    .replace(/`[^`\n]+`/g, "")
    .replace(/\{\{c\d+::([^}]+?)(?:::[^}]+?)?\}\}/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,2}/g, "")
    .replace(/^\s*>\s*/gm, "")
    .trim();
}

/**
 * Build fill-blank tokens from a card's front and back text.
 * Returns tokens (alternating text/blank) and the ordered answers array.
 * At most 3 random non-filler words are chosen as blanks.
 */
export function buildFillTokens(
  front: string,
  back: string,
): { tokens: FillToken[]; answers: string[] } {
  const combined = stripForFill(front) + "\n\n" + stripForFill(back);
  const parts = combined.split(/(\b[A-Za-z]{4,}\b)/);

  // First pass: identify all candidate blank positions (indices into parts[])
  const candidateIndices: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^[A-Za-z]{4,}$/.test(p) && !STOP_WORDS.has(p.toLowerCase())) {
      candidateIndices.push(i);
    }
  }

  // Randomly select up to 3 candidates
  const shuffled = [...candidateIndices].sort(() => Math.random() - 0.5);
  const selectedSet = new Set(shuffled.slice(0, 3));

  const tokens: FillToken[] = [];
  const answers: string[] = [];
  let blankIdx = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isCandidate = /^[A-Za-z]{4,}$/.test(part) && !STOP_WORDS.has(part.toLowerCase());
    if (isCandidate && selectedSet.has(i)) {
      tokens.push({ type: "blank", value: part, blankIndex: blankIdx });
      answers.push(part);
      blankIdx++;
    } else {
      const last = tokens[tokens.length - 1];
      if (last && last.type === "text") {
        last.value += part;
      } else {
        tokens.push({ type: "text", value: part, blankIndex: -1 });
      }
    }
  }

  return { tokens, answers };
}

/** Case-insensitive comparison with trimming. */
export function checkAnswer(input: string, answer: string): boolean {
  return input.trim().toLowerCase() === answer.toLowerCase();
}
