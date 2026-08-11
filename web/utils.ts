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
  /**
   * Rue de l'utilisateur allumée ? `null` si non authentifié. Peuplé par
   * routes/_middleware.ts pour que le Header sache s'il peut proposer les
   * liens « Le fil de ma rue »/« Mes messages » — ces pages redirigent vers
   * `/` tant que la rue n'est pas allumée (cf. revue : liens menant nulle
   * part sinon).
   */
  isStreetAwake: boolean | null;
}

export const define = createDefine<State>();
