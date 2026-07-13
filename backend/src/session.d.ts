import "express-session";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: number;
      email: string;
      isAdmin: boolean;
      teamId: number | null;
      teamName?: string;
    };
  }
}
