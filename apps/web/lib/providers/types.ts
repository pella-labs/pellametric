/**
 * Multi-provider abstraction. Business logic must call `getProvider(org.provider)`
 * and dispatch to one of these methods rather than branching on `org.provider`.
 *
 * See docs/multi-provider.md §4 for the full design.
 */

export type ProviderName = "github" | "gitlab";

/** A connectable org/group as listed for a user during onboarding. */
export type ConnectableOrg = {
  externalId: string | number;
  path: string;        // GitHub: login (e.g. "pella-labs"). GitLab: full_path ("pella-labs/team-a").
  name: string;
  avatar?: string | null;
};

/** Aggregates of pull/merge requests for one org member over a window. */
export type ChangeRequestAgg = {
  login: string;
  opened: number;
  merged: number;
  closed: number;       // closed-without-merge
  openNow: number;
  additions: number;
  deletions: number;
};

/** Result of inviting a member. Discriminated to capture provider-specific states. */
export type InviteResult =
  | { status: "added"; identifier: string }              // immediately member (e.g. GitLab user_id path)
  | { status: "invited"; identifier: string }            // GitHub email-pending invitation
  | { status: "pending_email"; identifier: string };     // GitLab email-invite to non-user

/** Lightweight reference to a member at the provider. */
export type MemberRef = {
  externalId: string | number;
  login: string;       // GitHub login or GitLab username
  name: string | null;
  avatar: string | null;
};

/** Common provider interface. Each method is called from server-side route handlers. */
export interface Provider {
  /** Orgs/groups the user can connect to Telemetryc. */
  listConnectableOrgs(userId: string): Promise<ConnectableOrg[]>;

  /** Persist a new connection. Implementation differs per provider (GitHub App callback vs GitLab GAT paste). */
  connectOrg(input: {
    userId: string;
    externalId: string | number;
    credential?: string;       // GitLab: GAT plaintext. GitHub: ignored (App handles it).
  }): Promise<{ orgId: string }>;

  /** Invite a member to an org. */
  inviteMember(orgId: string, identifier: string): Promise<InviteResult>;

  /** Aggregate change-request metrics (PRs / MRs) for one member over a window. */
  fetchChangeRequests(orgId: string, memberLogin: string, since?: Date | null): Promise<ChangeRequestAgg>;

  /** Look up a member at the provider by handle. Returns null if not found. */
  resolveMember(orgId: string, identifier: string): Promise<MemberRef | null>;

  /** Optional. Refresh credential if the provider supports it (e.g. GitHub App auto-refresh). */
  refreshCredential?(orgId: string): Promise<void>;
}
