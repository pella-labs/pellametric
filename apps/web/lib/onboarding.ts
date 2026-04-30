// Computes the onboarding checklist for a given (user, org) pair on the server.
// Steps are ordered; the first incomplete one becomes the "active" step that
// the client overlay highlights. When everything is complete, activeStep is null
// and the overlay won't render.

import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export type OnboardingStep = "install" | "invite" | "collector";

export type OnboardingState = {
  isManager: boolean;
  hasInstall: boolean;
  hasInvites: boolean;
  hasSessions: boolean;
  activeStep: OnboardingStep | null;
};

export async function computeOnboardingState(args: {
  userId: string;
  orgId: string;
  isManager: boolean;
  appConfigured: boolean;
  hasInstallationId: boolean;
}): Promise<OnboardingState> {
  const { userId, orgId, isManager, appConfigured, hasInstallationId } = args;

  // Run all three counts in parallel — keeps onboarding off the critical path.
  const [[invCount], [sessCount]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` })
      .from(schema.invitation)
      .where(eq(schema.invitation.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` })
      .from(schema.sessionEvent)
      .where(and(eq(schema.sessionEvent.orgId, orgId), eq(schema.sessionEvent.userId, userId))),
  ]);

  const hasInstall = hasInstallationId;
  const hasInvites = (invCount?.n ?? 0) > 0;
  const hasSessions = (sessCount?.n ?? 0) > 0;

  // Order: install (manager only, app must be configured) → invite (manager only) → collector (everyone)
  let activeStep: OnboardingStep | null = null;
  if (isManager && appConfigured && !hasInstall) activeStep = "install";
  else if (isManager && !hasInvites) activeStep = "invite";
  else if (!hasSessions) activeStep = "collector";

  return { isManager, hasInstall, hasInvites, hasSessions, activeStep };
}
