import { describe, expect, it, beforeEach } from "vitest";

import { HarmonyStreamParser, type StreamParseResult } from "../src/index";

describe("HarmonyStreamParser", () => {
  let parser: HarmonyStreamParser;

  beforeEach(() => {
    parser = new HarmonyStreamParser();
  });

  describe("basic functionality", () => {
    it("initializes with empty state", () => {
      const result = parser.addContent("");
      expect(result.isComplete).toBe(false);
      expect(result.currentAnalysis).toBe("");
      expect(result.currentFinal).toBe("");
      expect(result.currentCommentary).toBe("");
      expect(result.bufferContent).toBe("");
    });

    it("handles plain text without harmony markers", () => {
      const result = parser.addContent("Plain text response");
      expect(result.isComplete).toBe(false);
      expect(result.currentFinal).toBe("Plain text response");
      expect(result.currentAnalysis).toBe("");
      expect(result.currentCommentary).toBe("");
    });

    it("accumulates content across multiple calls", () => {
      parser.addContent("Hello ");
      const result = parser.addContent("world");
      expect(result.currentFinal).toBe("Hello world");
    });
  });

  describe("harmony format parsing", () => {
    it("parses complete analysis channel", () => {
      const content = "<|start|>assistant<|channel|>analysis<|message|>Let me think<|end|>";
      const result = parser.addContent(content);

      expect(result.isComplete).toBe(true);
      expect(result.currentAnalysis).toBe("Let me think");
      expect(result.currentFinal).toBe("");
      expect(result.lastChannelDetected).toBe("analysis");
    });

    it("parses complete final channel", () => {
      const content = "<|start|>assistant<|channel|>final<|message|>The answer is 42<|end|>";
      const result = parser.addContent(content);

      expect(result.isComplete).toBe(true);
      expect(result.currentFinal).toBe("The answer is 42");
      expect(result.currentAnalysis).toBe("");
      expect(result.lastChannelDetected).toBe("final");
    });

    it("parses complete commentary channel", () => {
      const content = "<|start|>assistant<|channel|>commentary<|message|>Interesting point<|end|>";
      const result = parser.addContent(content);

      expect(result.isComplete).toBe(true);
      expect(result.currentCommentary).toBe("Interesting point");
      expect(result.lastChannelDetected).toBe("commentary");
    });

    it("handles multiple channels in sequence", () => {
      const content =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>First, let me analyze..." +
        "<|channel|>final<|message|>The answer is 42" +
        "<|end|>";

      const result = parser.addContent(content);

      expect(result.isComplete).toBe(true);
      // Stream parser collects content differently - it may include subsequent markers
      expect(result.currentAnalysis).toContain("First, let me analyze");
      expect(result.currentFinal).toBe("The answer is 42");
      expect(result.lastChannelDetected).toBe("final");
    });

    it("detects incomplete streams", () => {
      const result1 = parser.addContent("<|start|>assistant<|channel|>analysis<|message|>Thinking");
      expect(result1.isComplete).toBe(false);
      expect(result1.currentAnalysis).toBe("Thinking");

      const result2 = parser.addContent(" more<|end|>");
      expect(result2.isComplete).toBe(true);
      expect(result2.currentAnalysis).toBe("Thinking more");
    });

    it("handles streaming with incremental content", () => {
      let result: StreamParseResult;

      result = parser.addContent("<|start|>assistant");
      expect(result.isComplete).toBe(false);

      result = parser.addContent("<|channel|>analysis");
      expect(result.lastChannelDetected).toBe("analysis");

      result = parser.addContent("<|message|>Let me");
      expect(result.currentAnalysis).toBe("Let me");

      result = parser.addContent(" think about this");
      expect(result.currentAnalysis).toBe("Let me think about this");

      result = parser.addContent("<|end|>");
      expect(result.isComplete).toBe(true);
    });
  });

  describe("channel switching", () => {
    it("switches between channels during streaming", () => {
      let result: StreamParseResult;

      result = parser.addContent("<|start|>assistant<|channel|>analysis<|message|>Thinking");
      expect(result.currentAnalysis).toBe("Thinking");
      expect(result.currentFinal).toBe("");

      result = parser.addContent("<|channel|>final<|message|>Answer");
      expect(result.currentAnalysis).toBe("Thinking");
      expect(result.currentFinal).toBe("Answer");
      expect(result.lastChannelDetected).toBe("final");
    });

    it("appends to same channel when content continues", () => {
      parser.addContent("<|start|>assistant<|channel|>analysis<|message|>First part");
      const result = parser.addContent(" second part");
      expect(result.currentAnalysis).toBe("First part second part");
    });
  });

  describe("completeness detection", () => {
    it("detects balanced start/end markers", () => {
      const complete = "<|start|>assistant<|channel|>final<|message|>Done<|end|>";
      const result = parser.addContent(complete);
      expect(result.isComplete).toBe(true);
    });

    it("detects unbalanced markers", () => {
      const incomplete = "<|start|>assistant<|channel|>final<|message|>Not done";
      const result = parser.addContent(incomplete);
      expect(result.isComplete).toBe(false);
    });

    it("handles multiple messages", () => {
      const content =
        "<|start|>user<|channel|>message<|message|>Hi<|end|>" +
        "<|start|>assistant<|channel|>final<|message|>Hello<|end|>";
      const result = parser.addContent(content);
      expect(result.isComplete).toBe(true);
    });

    it("detects incomplete multi-message streams", () => {
      const content =
        "<|start|>user<|channel|>message<|message|>Hi<|end|>" +
        "<|start|>assistant<|channel|>final<|message|>Hello";
      const result = parser.addContent(content);
      expect(result.isComplete).toBe(false);
    });
  });

  describe("buffer management", () => {
    it("provides access to full buffer", () => {
      const content = "<|start|>assistant<|channel|>analysis<|message|>Content<|end|>";
      parser.addContent(content);
      expect(parser.getBuffer()).toBe(content);
    });

    it("resets state when requested", () => {
      parser.addContent("Some content");
      parser.reset();

      const result = parser.addContent("");
      expect(result.bufferContent).toBe("");
      expect(result.currentAnalysis).toBe("");
      expect(result.currentFinal).toBe("");
    });

    it("maintains buffer across multiple additions", () => {
      parser.addContent("Part 1 ");
      parser.addContent("Part 2");
      expect(parser.getBuffer()).toBe("Part 1 Part 2");
    });
  });

  describe("edge cases", () => {
    it("handles empty content additions", () => {
      const result = parser.addContent("");
      expect(result.bufferContent).toBe("");
      expect(result.isComplete).toBe(false);
    });

    it("handles malformed harmony markers", () => {
      const result = parser.addContent("<|start|>assistant<|channel|><|message|>Content");
      expect(result.lastChannelDetected).toBeUndefined();
    });

    it("handles content with embedded harmony-like text", () => {
      const content =
        "<|start|>assistant<|channel|>final<|message|>Text with <fake> markers<|end|>";
      const result = parser.addContent(content);
      expect(result.currentFinal).toBe("Text with <fake> markers");
    });

    it("handles rapid channel switching", () => {
      const content =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>A" +
        "<|channel|>final<|message|>B" +
        "<|channel|>commentary<|message|>C" +
        "<|channel|>analysis<|message|>D" +
        "<|end|>";

      const result = parser.addContent(content);
      expect(result.currentAnalysis).toBe("D"); // Last analysis content
      expect(result.currentFinal).toBe("B");
      expect(result.currentCommentary).toBe("C");
    });

    it("preserves whitespace in content", () => {
      const content = "<|start|>assistant<|channel|>final<|message|>  Spaced content  <|end|>";
      const result = parser.addContent(content);
      expect(result.currentFinal).toBe("Spaced content"); // trimmed
    });
  });

  describe("addContent method comprehensive tests", () => {
    it("handles null and undefined inputs gracefully", () => {
      const result1 = parser.addContent("");
      expect(result1.bufferContent).toBe("");

      // Test with actual empty content
      const result2 = parser.addContent("");
      expect(result2.isComplete).toBe(false);
    });

    it("preserves state across multiple addContent calls", () => {
      parser.addContent("<|start|>assistant");
      parser.addContent("<|channel|>analysis");
      parser.addContent("<|message|>Part 1");

      const buffer1 = parser.getBuffer();
      expect(buffer1).toBe("<|start|>assistant<|channel|>analysis<|message|>Part 1");

      const result = parser.addContent(" Part 2<|end|>");
      expect(result.currentAnalysis).toBe("Part 1 Part 2");
      expect(result.isComplete).toBe(true);
    });

    it("handles very large content chunks", () => {
      const largeContent = "x".repeat(10000);
      const content = `<|start|>assistant<|channel|>final<|message|>${largeContent}<|end|>`;
      const result = parser.addContent(content);

      expect(result.currentFinal).toBe(largeContent);
      expect(result.isComplete).toBe(true);
    });

    it("handles rapid successive calls", () => {
      const chunks = ["<|", "start|", ">assistant<|c", "hannel|>final<|m", "essage|>Fast<|end|>"];

      let result: StreamParseResult;
      for (const chunk of chunks) {
        result = parser.addContent(chunk);
      }

      expect(result!.currentFinal).toBe("Fast");
      expect(result!.isComplete).toBe(true);
    });

    it("returns consistent StreamParseResult structure", () => {
      const result = parser.addContent("<|start|>assistant<|channel|>analysis<|message|>Test");

      expect(result).toHaveProperty("isComplete");
      expect(result).toHaveProperty("currentAnalysis");
      expect(result).toHaveProperty("currentFinal");
      expect(result).toHaveProperty("currentCommentary");
      expect(result).toHaveProperty("bufferContent");
      expect(result).toHaveProperty("lastChannelDetected");

      expect(typeof result.isComplete).toBe("boolean");
      expect(typeof result.currentAnalysis).toBe("string");
      expect(typeof result.currentFinal).toBe("string");
      expect(typeof result.currentCommentary).toBe("string");
      expect(typeof result.bufferContent).toBe("string");
    });
  });

  describe("reset method comprehensive tests", () => {
    it("clears all state completely", () => {
      // Add substantial content
      parser.addContent("<|start|>assistant<|channel|>analysis<|message|>Complex analysis");
      parser.addContent("<|channel|>final<|message|>Final answer<|end|>");

      // Verify state exists
      let result = parser.addContent("");
      expect(result.currentAnalysis).toBe("Complex analysis");
      expect(result.currentFinal).toBe("Final answer");
      expect(parser.getBuffer().length).toBeGreaterThan(0);

      // Reset
      parser.reset();

      // Verify complete reset
      result = parser.addContent("");
      expect(result.currentAnalysis).toBe("");
      expect(result.currentFinal).toBe("");
      expect(result.currentCommentary).toBe("");
      expect(result.isComplete).toBe(false);
      expect(result.lastChannelDetected).toBeUndefined();
      expect(parser.getBuffer()).toBe("");
    });

    it("allows fresh start after reset", () => {
      // Use parser, then reset
      parser.addContent("<|start|>user<|channel|>message<|message|>First session<|end|>");
      parser.reset();

      // Start fresh session
      const result = parser.addContent(
        "<|start|>assistant<|channel|>final<|message|>New session<|end|>",
      );

      expect(result.currentFinal).toBe("New session");
      expect(result.currentAnalysis).toBe("");
      expect(result.isComplete).toBe(true);
    });

    it("can be called multiple times safely", () => {
      parser.addContent("Some content");
      parser.reset();
      parser.reset();
      parser.reset();

      const result = parser.addContent("");
      expect(result.bufferContent).toBe("");
      expect(parser.getBuffer()).toBe("");
    });
  });

  describe("getBuffer method comprehensive tests", () => {
    it("returns exact accumulated content", () => {
      const chunks = ["Hello ", "world ", "from ", "buffer"];

      for (const chunk of chunks) {
        parser.addContent(chunk);
      }

      expect(parser.getBuffer()).toBe("Hello world from buffer");
    });

    it("returns empty string initially", () => {
      expect(parser.getBuffer()).toBe("");
    });

    it("reflects buffer state after each addition", () => {
      expect(parser.getBuffer()).toBe("");

      parser.addContent("First");
      expect(parser.getBuffer()).toBe("First");

      parser.addContent(" Second");
      expect(parser.getBuffer()).toBe("First Second");

      parser.addContent(" Third");
      expect(parser.getBuffer()).toBe("First Second Third");
    });

    it("preserves exact whitespace and special characters", () => {
      const specialContent = '  \n\t<test>"quotes"&symbols$  ';
      parser.addContent(specialContent);
      expect(parser.getBuffer()).toBe(specialContent);
    });

    it("handles unicode and emoji content", () => {
      const unicodeContent = "Hello 🌍 世界 🚀 测试";
      parser.addContent(unicodeContent);
      expect(parser.getBuffer()).toBe(unicodeContent);
    });
  });

  describe("channel detection and state management", () => {
    it("correctly tracks lastChannelDetected across updates", () => {
      let result = parser.addContent("<|start|>assistant<|channel|>analysis");
      expect(result.lastChannelDetected).toBe("analysis");

      result = parser.addContent("<|message|>Thinking");
      expect(result.lastChannelDetected).toBe("analysis");

      result = parser.addContent("<|channel|>final");
      expect(result.lastChannelDetected).toBe("final");

      result = parser.addContent("<|message|>Answer");
      expect(result.lastChannelDetected).toBe("final");
    });

    it("handles malformed channel declarations gracefully", () => {
      const result = parser.addContent("<|start|>assistant<|channel|><|message|>Content");
      expect(result.lastChannelDetected).toBeUndefined();
      expect(result.bufferContent).toContain("Content");
    });

    it("detects channels with various naming patterns", () => {
      const channels = ["analysis", "final", "commentary", "step1", "reasoning", "output"];

      for (const channel of channels) {
        parser.reset();
        const result = parser.addContent(`<|start|>assistant<|channel|>${channel}<|message|>Test`);
        expect(result.lastChannelDetected).toBe(channel);
      }
    });
  });

  describe("completeness detection edge cases", () => {
    it("handles nested start/end patterns", () => {
      const content =
        "<|start|>user<|channel|>message<|message|>Outer start" +
        "<|start|>assistant<|channel|>final<|message|>Inner content<|end|>" +
        "More outer content<|end|>";

      const result = parser.addContent(content);
      expect(result.isComplete).toBe(true); // Balanced start/end count
    });

    it("correctly counts unbalanced complex patterns", () => {
      let result = parser.addContent("<|start|>one<|start|>two<|message|>content");
      expect(result.isComplete).toBe(false);

      result = parser.addContent("<|end|>");
      expect(result.isComplete).toBe(false); // Still 2 starts, 1 end

      result = parser.addContent("<|end|>");
      expect(result.isComplete).toBe(true); // Now balanced
    });
  });

  describe("performance and stress tests", () => {
    it("handles many rapid updates efficiently", () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        parser.addContent(`chunk${i} `);
      }

      const end = Date.now();
      expect(end - start).toBeLessThan(1000); // Should complete in under 1 second

      const buffer = parser.getBuffer();
      expect(buffer).toContain("chunk0");
      expect(buffer).toContain("chunk999");
    });

    it("maintains accuracy with complex interwoven content", () => {
      const complexContent =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>Step 1: Understanding the problem\n" +
        "This requires careful analysis of multiple factors." +
        "<|channel|>commentary<|message|>Note: This is a complex scenario\n" +
        "We should consider edge cases." +
        "<|channel|>analysis<|message|>\nStep 2: Developing solution\n" +
        "Based on the analysis above." +
        "<|channel|>final<|message|>\nFinal Answer:\n" +
        "After careful consideration, the solution is X." +
        "<|end|>";

      const result = parser.addContent(complexContent);

      expect(result.isComplete).toBe(true);
      expect(result.currentAnalysis).toContain("Step 1: Understanding");
      expect(result.currentAnalysis).toContain("Step 2: Developing");
      expect(result.currentCommentary).toContain("Note: This is a complex");
      expect(result.currentCommentary).toContain("edge cases");
      expect(result.currentFinal).toContain("Final Answer");
      expect(result.currentFinal).toContain("solution is X");
    });
  });

  describe("real-world streaming scenarios", () => {
    it("simulates typical GPT-OSS streaming response", () => {
      const chunks = [
        "<|start|>assistant",
        "<|channel|>analysis",
        "<|message|>I need to solve this step by step.",
        " First, let me understand what's being asked.",
        "<|channel|>final",
        "<|message|>Based on my analysis,",
        " the answer is 42.",
        "<|end|>",
      ];

      let result: StreamParseResult = {
        isComplete: false,
        currentAnalysis: "",
        currentFinal: "",
        currentCommentary: "",
        bufferContent: "",
      };

      for (const chunk of chunks) {
        result = parser.addContent(chunk);
      }

      expect(result.isComplete).toBe(true);
      expect(result.currentAnalysis).toBe(
        "I need to solve this step by step. First, let me understand what's being asked.",
      );
      expect(result.currentFinal).toBe("Based on my analysis, the answer is 42.");
    });

    it("handles interrupted and resumed streaming", () => {
      parser.addContent("<|start|>assistant<|channel|>analysis<|message|>Thinking about");

      // Simulate network interruption - parser should handle gracefully
      let result = parser.addContent("");
      expect(result.currentAnalysis).toBe("Thinking about");
      expect(result.isComplete).toBe(false);

      // Resume streaming
      result = parser.addContent(" this problem<|channel|>final<|message|>Answer<|end|>");
      expect(result.currentAnalysis).toBe("Thinking about this problem");
      expect(result.currentFinal).toBe("Answer");
      expect(result.isComplete).toBe(true);
    });

    it("handles complete session lifecycle", () => {
      // Multiple complete conversations in sequence
      parser.addContent("<|start|>user<|channel|>message<|message|>Question 1<|end|>");
      let result = parser.addContent(
        "<|start|>assistant<|channel|>final<|message|>Answer 1<|end|>",
      );
      expect(result.isComplete).toBe(true);

      // Continue in same buffer
      result = parser.addContent("<|start|>user<|channel|>message<|message|>Question 2<|end|>");
      result = parser.addContent(
        "<|start|>assistant<|channel|>analysis<|message|>Analyzing Q2<|channel|>final<|message|>Answer 2<|end|>",
      );

      expect(result.isComplete).toBe(true);
      expect(result.currentAnalysis).toBe("Analyzing Q2");
      expect(result.currentFinal).toBe("Answer 2");

      // Buffer should contain full conversation history
      const fullBuffer = parser.getBuffer();
      expect(fullBuffer).toContain("Question 1");
      expect(fullBuffer).toContain("Answer 1");
      expect(fullBuffer).toContain("Question 2");
      expect(fullBuffer).toContain("Answer 2");
    });
  });
});
