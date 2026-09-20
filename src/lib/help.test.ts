import { describe, expect, it } from "vitest";
import { analyzeFixture } from "../test/fixtures";
import { buildHelpAnswer, HELP_TOPICS } from "./help";

const withAnalysis = { analysis: analyzeFixture, selectionCount: 2 };

describe("HELP_TOPICS", () => {
  it("exposes exactly the documented predefined prompts", () => {
    expect(HELP_TOPICS.map((topic) => topic.prompt)).toEqual([
      "Why is my risk high?",
      "Which commute is hardest?",
      "What does GPA confidence mean?",
      "How can I compare sections?",
    ]);
  });
});

describe("buildHelpAnswer", () => {
  it("explains the current risk score and factors from the backend response", () => {
    const answer = buildHelpAnswer("risk", withAnalysis);
    expect(answer).toContain("41/100");
    expect(answer).toContain("Moderate");
    expect(answer).toContain("Heavy-course load");
    expect(answer).toContain("12.0 of 30.0");
    expect(answer).toContain("not a prediction");
  });

  it("asks for another section when no analysis exists yet", () => {
    const answer = buildHelpAnswer("risk", { analysis: undefined, selectionCount: 1 });
    expect(answer).toContain("at least one more section");
  });

  it("names the hardest backend-reported transitions by verdict", () => {
    const answer = buildHelpAnswer("commute", withAnalysis);
    expect(answer).toContain("1 walking warning");
    expect(answer).toContain("Impossible transitions");
    expect(answer).toContain("90001");
    expect(answer).toContain("90003");
  });

  it("reports when the backend found no commute warnings", () => {
    const noWarnings = {
      ...analyzeFixture,
      commute_warnings: [],
    };
    const answer = buildHelpAnswer("commute", { analysis: noWarnings, selectionCount: 2 });
    expect(answer).toContain("no tight or impossible walking transitions");
  });

  it("explains GPA confidence using the current result", () => {
    const answer = buildHelpAnswer("gpa", withAnalysis);
    expect(answer).toContain("3.15");
    expect(answer).toContain("low confidence");
    expect(answer).toContain("not your grade");
  });

  it("explains how to compare sections and the current selection count", () => {
    const answer = buildHelpAnswer("compare", { analysis: undefined, selectionCount: 3 });
    expect(answer).toContain("swap workbench");
    expect(answer).toContain("3 selected sections");
  });
});
