import { createDefine } from "fresh";
import type { Theme } from "./utils/theme.ts";

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
  /**
   * Numéro du foyer (facultatif, cf. /rejoindre), affiché/modifiable sur
   * /profil — optionnel ici pour ne pas casser les `SessionUser` construits
   * à la main dans les tests qui ne le renseignent pas.
   */
  houseNumber?: string | null;
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
  /**
   * Vrai si l'utilisateur a au moins un message privé non lu — pour la
   * pastille sur l'enveloppe du menu (cf. Header.tsx, backlog). Toujours
   * `false` si non authentifié.
   */
  hasUnreadMessages: boolean;
  /**
   * Préférence d'apparence explicite (cf. Header.tsx, menu de compte),
   * `null` = suit la préférence système. Peuplée par routes/_middleware.ts
   * depuis le cookie `notrerue_theme`, disponible même non authentifié
   * (contrairement à `user`/`isStreetAwake`) : le choix d'apparence n'a pas
   * de raison de dépendre d'une session.
   */
  theme: Theme | null;
}

export const define = createDefine<State>();
