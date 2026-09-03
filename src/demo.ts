import type { Attempt, Team, CategoryId } from "./domain";
const names = [
  "陳宥安",
  "林芷晴",
  "黃品睿",
  "張語彤",
  "李承恩",
  "王以樂",
  "吳柏宇",
  "劉昕妤",
  "蔡睿哲",
  "楊可芯",
  "許家佑",
  "鄭予涵",
  "謝宇軒",
  "洪子晴",
  "郭奕辰",
  "邱若甯",
  "曾冠廷",
  "廖心妍",
  "賴昱翔",
  "徐采潔",
  "周廷佑",
  "葉詠恩",
  "蘇禹丞",
  "莊庭萱",
];
// Fictional individual entrants; keep IDs stable so sample scores stay linked.
export const demoTeams: Team[] = (
  ["preschool", "power", "program", "creative"] as CategoryId[]
).flatMap((categoryId, c) =>
  (categoryId === "preschool" ? [] : names.slice(c * 6, (c + 1) * 6)).map(
    (name, i) => ({
      id: categoryId + "-" + (i + 1),
      number: "ABCD"[c] + String(i + 1).padStart(3, "0"),
      name,
      heat: (i % (categoryId === "program" ? 3 : 2)) + 1,
      categoryId,
      checkinStatus: i < 5 ? "checked_in" : "pending",
    }),
  ),
);
const now = new Date().toISOString();
let id = 0;
export const demoAttempts: Attempt[] = demoTeams.flatMap((t, i): Attempt[] => {
  if (i % 6 > 3) return [];
  const base = {
    teamId: t.id,
    categoryId: t.categoryId,
    submittedAt: now,
    status: "valid" as const,
  };
  if (t.categoryId === "preschool")
    return [0, 1].map((r) => ({
      ...base,
      id: "a" + ++id,
      slotKey: "round-" + (r + 1),
      attemptNo: r + 1,
      data: { childGoals: Math.max(0, 4 - (i % 3) - r), parentGoals: 2 - r },
    }));
  if (t.categoryId === "power")
    return ["pull-1", "push-1"].map((slotKey, r) => ({
      ...base,
      id: "a" + ++id,
      slotKey,
      attemptNo: r + 1,
      data: { bottles: 10 - (i % 4), seconds: 12 + (i % 3) + r },
    }));
  if (t.categoryId === "program")
    return [0, 1].map((r) => ({
      ...base,
      id: "a" + ++id,
      slotKey: "round-" + (r + 1),
      attemptNo: r + 1,
      data: {
        completed: 1,
        seconds: 14.8 + (i % 4) + r * 0.4,
        weight: 620 + i * 12,
      },
    }));
  return ["left", "right"].map((slotKey, r) => ({
    ...base,
    id: "a" + ++id,
    slotKey,
    attemptNo: r + 1,
    data: {
      regular: 8 - (i % 4) - r,
      red: "correct",
      blue: r ? "wrong" : "correct",
      seconds: 18 + (i % 4) + r,
    },
  }));
});
