import { fuzzyScore } from "./fuzzy.ts";

export interface FileSearchCandidate {
  name: string;
  path: string;
}

function normalized(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase();
}

function matchScore(query: string, value: string): number {
  const index = value.indexOf(query);
  return index >= 0
    ? 1_000 - index * 10 - value.length * 0.01
    : fuzzyScore(query, value);
}

export function searchFileCandidates<T extends FileSearchCandidate>(
  query: string,
  candidates: T[],
  limit = 30,
): T[] {
  const q = normalized(query.trim());
  if (!q) return candidates.slice(0, limit);

  return candidates
    .map((item) => {
      const nameScore = matchScore(q, normalized(item.name));
      const slash = item.path.lastIndexOf("/");
      const folder = slash < 0 ? "" : normalized(item.path.slice(0, slash));
      const folderScore = matchScore(q, folder);
      return {
        item,
        score: nameScore >= 0 ? 2_000 + nameScore : folderScore,
      };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path))
    .slice(0, limit)
    .map(({ item }) => item);
}
