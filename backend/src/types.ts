export interface ShooterScore {
  name: string;
  stations: (number | null)[]; // length 5, each 0-5 or null
  total: number | null;
  subFor?: string | null; // name of the team member this shooter subbed for, if any
}

export interface RoundInput {
  teamId: number;
  date: string; // YYYY-MM-DD
  yardage: number | null; // one value for the whole round, e.g. 16
  roundNumber: number; // e.g. 1 or 2, for clubs shooting multiple rounds a night
  shooters: ShooterScore[];
}
