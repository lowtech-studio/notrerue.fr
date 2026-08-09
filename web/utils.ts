import { createDefine } from "fresh";

export interface SessionUser {
  id: number;
  login: string;
  email: string;
  isAmbassador: boolean;
  street: {
    id: number;
    name: string;
    city: { id: number; name: string };
  };
}

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  /** Peuplé par routes/_middleware.ts ; `null` si non authentifié. */
  user: SessionUser | null;
}

export const define = createDefine<State>();
