export function awardLabel(award: {
  rank: number | null;
  award_type?: "rank" | "merit";
}) {
  if (award.award_type === "merit") return "佳作";
  return award.rank === null ? "" : `第 ${award.rank} 名`;
}

export function validAwardQuotas(rank: string, merit: string) {
  return (
    [rank, merit].every((v) => /^\d+$/.test(v) && Number(v) <= 500) &&
    Number(rank) + Number(merit) >= 1 &&
    Number(rank) + Number(merit) <= 500
  );
}
