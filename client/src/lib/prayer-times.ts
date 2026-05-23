// Approximate London (UK) prayer times, interpolated by month.
// Values are minutes from midnight in LOCAL time (accounts for GMT/BST).
// Index 0 = January, 11 = December.
// Columns: [Fajr, Dhuhr, Asr, Maghrib, Isha]
const MONTHLY_MINS: [number, number, number, number, number][] = [
  [384, 730, 840,  965, 1056], // Jan
  [345, 734, 887, 1024, 1119], // Feb
  [293, 725, 937, 1085, 1185], // Mar
  [241, 786, 994, 1204, 1318], // Apr  (BST: clocks +1h already reflected)
  [192, 782, 1035, 1261, 1379], // May
  [165, 785, 1066, 1290, 1435], // Jun
  [175, 794, 1069, 1284, 1426], // Jul
  [222, 788, 1038, 1245, 1359], // Aug
  [273, 770, 1001, 1175, 1263], // Sep
  [322, 759,  946, 1086, 1177], // Oct
  [367, 734,  896, 1009, 1101], // Nov
  [389, 725,  838,  956, 1047], // Dec
];

export const PRAYER_NAMES = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;
export type PrayerName = (typeof PRAYER_NAMES)[number];

export interface PrayerTime {
  name: PrayerName;
  time: string;
  hour: number;
  minutesFromMidnight: number;
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function getPrayerTimes(dateStr: string): PrayerTime[] {
  const d = new Date(dateStr + "T12:00:00");
  const month = d.getMonth();
  const nextMonth = (month + 1) % 12;
  const daysInMonth = new Date(d.getFullYear(), month + 1, 0).getDate();
  const t = (d.getDate() - 1) / daysInMonth;

  const from = MONTHLY_MINS[month];
  const to = MONTHLY_MINS[nextMonth];

  return PRAYER_NAMES.map((name, i) => {
    const mins = Math.round(from[i] + (to[i] - from[i]) * t);
    const safeMins = ((mins % 1440) + 1440) % 1440;
    return {
      name,
      time: toHHMM(safeMins),
      hour: Math.floor(safeMins / 60),
      minutesFromMidnight: safeMins,
    };
  });
}
