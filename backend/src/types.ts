export interface ShooterScore {
  name: string;
  stations: (number | null)[]; // length 5, each 0-5 or null
  total: number | null;
}

export interface RoundInput {
  date: string; // YYYY-MM-DD
  shooters: ShooterScore[];
}
