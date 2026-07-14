export interface ShooterScore {
  name: string;
  stations: (number | null)[]; // length 5, each 0-5 or null
  total: number | null;
}

export interface RoundInput {
  teamId: number;
  date: string; // YYYY-MM-DD
  yardage: number | null; // one value for the whole round, e.g. 16
  shooters: ShooterScore[];
}
