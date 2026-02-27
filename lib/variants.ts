import type { Account } from "@prisma/client";
import { buildSimilarityKey } from "@/lib/risk";

function suffixByIndex(index: number): string {
  const templates = [
    "",
    "\n\nKey point: focus on clarity first.",
    "\n\nAngle: this matters because execution speed compounds.",
    "\n\nPerspective: tested with creator ops workflows.",
    "\n\nTakeaway: adapt this to your own content cadence."
  ];
  return templates[index % templates.length];
}

export function buildVariantBody(baseBody: string, account: Pick<Account, "username" | "language">, index: number): string {
  const lead =
    index % 2 === 0
      ? baseBody.trim()
      : `${baseBody.trim()}\n\n(${account.username} edition)`;
  const languageLine =
    account.language && account.language.toLowerCase().startsWith("zh")
      ? "\n\n如需中文版流程图，回复关键词即可。"
      : "";
  return `${lead}${suffixByIndex(index)}${languageLine}`.trim();
}

export function buildVariantKey(body: string): string {
  return buildSimilarityKey(body);
}
