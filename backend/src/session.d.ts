import "express-session";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: number;
      email: string;
      name: string | null;
      isAdmin: boolean;
      teamId: number | null;
      teamName?: string;
    };
  }
}
