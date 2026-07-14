import "express-session";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: number;
      email: string;
      name: string | null;
      phone: string | null;
      address: string | null;
      isAdmin: boolean;
      isSquadLeader: boolean;
      teamId: number | null;
      teamName?: string;
      // False while a join-an-existing-team request is awaiting approval.
      // Meaningless when teamId is null (no team picked yet) — the frontend
      // checks teamId first, then this.
      teamApproved: boolean;
    };
  }
}
