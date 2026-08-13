/**
 * Fake sign-on.
 *
 * The only thing faked here is the credential check. Everything downstream is
 * the real shape: a session resolves to a membership, the membership carries
 * the role and market, and every repository read is scoped by that context.
 *
 * Swapping in real authentication means replacing `signIn` — nothing else in
 * the app reads credentials or decides a role.
 */

import type { ActorContext, ActorRole, Membership } from "@/domain/types";
import * as seed from "./seed";
import { brand } from "@/brand";

export interface DemoAccount {
  id: string;
  role: ActorRole;
  label: string;
  organizationName: string;
  marketName: string;
  description: string;
}

interface AccountDefinition extends DemoAccount {
  membership: Membership;
}

const ACCOUNTS: AccountDefinition[] = [
  {
    id: "acct-admin",
    role: "admin",
    label: "Steve Weed",
    organizationName: brand.operatorName,
    marketName: "All markets",
    description: "Program administrator. The only cross-market role.",
    membership: {
      id: "mem-admin",
      userId: "u-admin",
      organizationId: null,
      marketId: null,
      role: "admin",
    },
  },
  {
    id: "acct-student",
    role: "student",
    label: "Omar Haddad",
    organizationName: "Verdigris State University",
    marketName: "Southeast Kansas",
    description:
      "Computer Science sophomore, stuck in the pause and banking micro-internship hours.",
    membership: {
      id: "mem-student",
      userId: "u-omar",
      organizationId: "org-verdigris",
      marketId: "mkt-pittsburg",
      role: "student",
    },
  },
  {
    id: "acct-business",
    role: "business",
    label: "Dana Reyes",
    organizationName: "Apex Robotics",
    marketName: "Southeast Kansas",
    description: "Hiring manager with two open postings and interns on site.",
    membership: {
      id: "mem-business",
      userId: "u-dana",
      organizationId: "org-apex",
      marketId: "mkt-pittsburg",
      role: "business",
    },
  },
  {
    id: "acct-college",
    role: "college",
    label: "Dr. Ellen Vance",
    organizationName: "Verdigris State University",
    marketName: "Southeast Kansas",
    description: "Internship director. Verifies students and grants credit.",
    membership: {
      id: "mem-college",
      userId: "u-ellen",
      organizationId: "org-verdigris",
      marketId: "mkt-pittsburg",
      role: "college",
    },
  },
  {
    id: "acct-board",
    role: "board",
    label: "Marcia Delgado",
    organizationName: "Southeast Kansas Workforce Partnership",
    marketName: "Southeast Kansas",
    description: "Workforce officer. Determines eligibility and authorizes funding.",
    membership: {
      id: "mem-board",
      userId: "u-marcia",
      organizationId: "org-sekwp",
      marketId: "mkt-pittsburg",
      role: "board",
    },
  },
];

/** Public account list, with the membership stripped so it cannot leak. */
export const demoAccounts: DemoAccount[] = ACCOUNTS.map((account) => {
  const { membership, ...rest } = account;
  void membership;
  return rest;
});

/** Resolve an account into the actor context every repository read requires. */
export function contextFor(role: ActorRole): ActorContext {
  const account = ACCOUNTS.find((a) => a.role === role) ?? ACCOUNTS[0];
  const user = seed.users.find((u) => u.id === account.membership.userId)!;
  return { user, membership: account.membership };
}

export function accountFor(role: ActorRole): DemoAccount {
  return demoAccounts.find((a) => a.role === role) ?? demoAccounts[0];
}

/**
 * The faked credential check. A real implementation verifies a password or an
 * SSO assertion and returns the same shape.
 */
export function signIn(role: ActorRole): ActorContext {
  return contextFor(role);
}
