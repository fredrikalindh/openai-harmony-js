import { describe, expect, it } from "vitest";

import { extractFinalContent, extractReasoningContent } from "../src/index";

describe("content extraction", () => {
  describe("extractReasoningContent", () => {
    it("extracts analysis content", () => {
      const input =
        "<|start|>assistant<|channel|>analysis<|message|>Let me think about this<|end|>";
      const result = extractReasoningContent(input);
      expect(result).toBe("Let me think about this");
    });

    it("extracts from complex stream with multiple channels", () => {
      const input =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>First, I need to understand..." +
        "<|channel|>final<|message|>The answer is 42" +
        "<|end|>";
      const result = extractReasoningContent(input);
      expect(result).toBe("First, I need to understand...");
    });

    it("handles partial/incomplete streams", () => {
      const input = "<|start|>assistant<|channel|>analysis<|message|>Thinking about";
      const result = extractReasoningContent(input);
      expect(result).toBe("Thinking about");
    });

    it("uses last occurrence for streaming", () => {
      const input =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>First thought<|end|>" +
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>Updated thought";
      const result = extractReasoningContent(input);
      expect(result).toBe("Updated thought");
    });

    it("returns empty string for non-harmony content", () => {
      const result = extractReasoningContent("Plain text");
      expect(result).toBe("");
    });

    it("returns empty string when no analysis channel", () => {
      const input = "<|start|>assistant<|channel|>final<|message|>Just the answer<|end|>";
      const result = extractReasoningContent(input);
      expect(result).toBe("");
    });

    it("cleans up token markers in content", () => {
      const input = "<|start|>assistant<|channel|>analysis<|message|>Thinking<|start|>about<|end|>";
      const result = extractReasoningContent(input);
      expect(result).toBe("Thinking");
    });

    it("removes partial token markers at end", () => {
      const input = "<|start|>assistant<|channel|>analysis<|message|>Thinking<|ch";
      const result = extractReasoningContent(input);
      expect(result).toBe("Thinking");
    });

    it("handles multiple analysis blocks", () => {
      const input =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>First analysis" +
        "<|channel|>final<|message|>Answer" +
        "<|channel|>analysis<|message|>Second analysis" +
        "<|end|>";
      const result = extractReasoningContent(input);
      expect(result).toBe("Second analysis");
    });
  });

  describe("extractFinalContent", () => {
    it("extracts final content", () => {
      const input = "<|start|>assistant<|channel|>final<|message|>The answer is 42<|end|>";
      const result = extractFinalContent(input);
      expect(result).toBe("The answer is 42");
    });

    it("prefers final over commentary", () => {
      const input =
        "<|start|>assistant" +
        "<|channel|>commentary<|message|>Some commentary" +
        "<|channel|>final<|message|>The final answer" +
        "<|end|>";
      const result = extractFinalContent(input);
      expect(result).toBe("The final answer");
    });

    it("falls back to commentary when no final", () => {
      const input = "<|start|>assistant<|channel|>commentary<|message|>Commentary text<|end|>";
      const result = extractFinalContent(input);
      expect(result).toBe("Commentary text");
    });

    it("returns original input for non-harmony content", () => {
      const plainText = "Plain text answer";
      const result = extractFinalContent(plainText);
      expect(result).toBe(plainText);
    });

    it("returns empty string when no final or commentary", () => {
      const input = "<|start|>assistant<|channel|>analysis<|message|>Just thinking<|end|>";
      const result = extractFinalContent(input);
      expect(result).toBe("");
    });

    it("handles streaming content", () => {
      const input = "<|start|>assistant<|channel|>final<|message|>The answer is";
      const result = extractFinalContent(input);
      expect(result).toBe("The answer is");
    });

    it("uses last occurrence for final channel", () => {
      const input =
        "<|start|>assistant" +
        "<|channel|>final<|message|>First answer<|end|>" +
        "<|start|>assistant" +
        "<|channel|>final<|message|>Updated answer";
      const result = extractFinalContent(input);
      expect(result).toBe("Updated answer");
    });

    it("cleans up embedded token markers", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Answer<|channel|>with<|message|>embedded<|end|>";
      const result = extractFinalContent(input);
      expect(result).toBe("Answer");
    });

    it("handles complex multi-channel conversation", () => {
      const input =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>Let me analyze this problem..." +
        "<|channel|>commentary<|message|>This is interesting because..." +
        "<|channel|>final<|message|>Based on my analysis, the answer is 42" +
        "<|end|>";
      const result = extractFinalContent(input);
      expect(result).toBe("Based on my analysis, the answer is 42");
    });

    it("handles empty channels gracefully", () => {
      const input = "<|start|>assistant<|channel|>final<|message|><|end|>";
      const result = extractFinalContent(input);
      expect(result).toBe("");
    });
  });
});
