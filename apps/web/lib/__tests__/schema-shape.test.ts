import { describe, it, expect } from "vitest";
import {
  pr,
  prCommit,
  costPerPr,
  org,
  modelPricing,
  lineageJob,
  systemHealth,
  dailyUserStats,
  dailyOrgStats,
  cohortQueryLog,
  backfillState,
  sessionPrLink,
  sessionEvent,
} from "@/lib/db/schema";

describe("schema shape — insights revamp tables", () => {
  it("pr.kind default is 'standard'", () => {
    expect(pr.kind.default).toBe("standard");
  });

  it("prCommit.kind default is 'commit'", () => {
    expect(prCommit.kind.default).toBe("commit");
  });

  it("prCommit.aiSources is an array column", () => {
    // drizzle marks array columns; type level we check the property exists and dataType
    expect(prCommit.aiSources).toBeDefined();
    expect(prCommit.aiSources.dataType).toBe("array");
  });

  it("costPerPr.priceVersion default is 0 and integer", () => {
    expect(costPerPr.priceVersion.default).toBe(0);
    expect(costPerPr.priceVersion.dataType).toBe("number");
  });

  it("org.aiFooterPolicy default is 'optional'", () => {
    expect(org.aiFooterPolicy.default).toBe("optional");
  });

  it("sessionEvent has branch + cwdResolvedRepo columns", () => {
    expect(sessionEvent.branch).toBeDefined();
    expect(sessionEvent.cwdResolvedRepo).toBeDefined();
  });

  it("sessionPrLink has new confidence enrichment columns", () => {
    expect(sessionPrLink.fileJaccard).toBeDefined();
    expect(sessionPrLink.confidenceScore).toBeDefined();
    expect(sessionPrLink.linkSource.default).toBe("auto");
  });

  it("all new insights tables exported", () => {
    expect(modelPricing).toBeDefined();
    expect(lineageJob).toBeDefined();
    expect(systemHealth).toBeDefined();
    expect(dailyUserStats).toBeDefined();
    expect(dailyOrgStats).toBeDefined();
    expect(cohortQueryLog).toBeDefined();
    expect(backfillState).toBeDefined();
  });
});
