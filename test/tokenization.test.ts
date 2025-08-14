import { describe, expect, it } from "vitest";

import {
  tokenizeCompletionString,
  parseConversationFromString,
  isHarmonyFormat,
  type HarmonyDelimiters,
} from "../src/index";

describe("string tokenization", () => {
  describe("tokenizeCompletionString", () => {
    it("tokenizes basic harmony string", () => {
      const input = "<|start|>user<|message|>Hello<|end|>";
      const tokens = tokenizeCompletionString(input);
      expect(tokens).toEqual(["<|start|>user", "<|message|>", "Hello", "<|end|>"]);
    });

    it("tokenizes complex conversation", () => {
      const input =
        "<|start|>system<|message|>You are helpful<|end|>" +
        "<|start|>user<|message|>Hello there<|end|>" +
        "<|start|>assistant<|message|>Hi! How can I help?<|end|>";

      const tokens = tokenizeCompletionString(input);
      expect(tokens).toEqual([
        "<|start|>system",
        "<|message|>",
        "You are helpful",
        "<|end|>",
        "<|start|>user",
        "<|message|>",
        "Hello there",
        "<|end|>",
        "<|start|>assistant",
        "<|message|>",
        "Hi! How can I help?",
        "<|end|>",
      ]);
    });

    it("handles multiple channels with harmony format", () => {
      const input =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>Let me think..." +
        "<|channel|>final<|message|>The answer is 42" +
        "<|end|>";

      const tokens = tokenizeCompletionString(input);
      expect(tokens).toEqual([
        "<|start|>assistant",
        "<|channel|>analysis",
        "<|message|>",
        "Let me think...<|channel|>final",
        "<|message|>",
        "The answer is 42",
        "<|end|>",
      ]);
    });

    it("handles custom delimiters", () => {
      const customDelims: HarmonyDelimiters = {
        start: "<<S>>",
        message: "<<M>>",
        end: "<<E>>",
      };
      const input = "<<S>>user<<M>>Hello<<E>>";
      const tokens = tokenizeCompletionString(input, customDelims);
      expect(tokens).toEqual(["<<S>>user", "<<M>>", "Hello", "<<E>>"]);
    });

    it("handles empty content between delimiters", () => {
      const input = "<|start|>user<|message|><|end|>";
      const tokens = tokenizeCompletionString(input);
      expect(tokens).toEqual(["<|start|>user", "<|message|>", "<|end|>"]);
    });

    it("handles content without delimiters", () => {
      const input = "Plain text without delimiters";
      const tokens = tokenizeCompletionString(input);
      expect(tokens).toEqual(["Plain text without delimiters"]);
    });

    it("handles overlapping delimiter-like content", () => {
      const input = "<|start|>user<|message|>Text with <|fake|> markers<|end|>";
      const tokens = tokenizeCompletionString(input);
      expect(tokens).toEqual([
        "<|start|>user",
        "<|message|>",
        "Text with <|fake|> markers",
        "<|end|>",
      ]);
    });
  });

  describe("parseConversationFromString", () => {
    it("parses basic conversation string", () => {
      const input = "<|start|>user<|message|>text:message:Hello<|end|>";
      const result = parseConversationFromString(input);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content).toEqual([
        { type: "text", channel: "message", text: "Hello" },
      ]);
    });

    it("parses multi-message conversation", () => {
      const input =
        "<|start|>system<|message|>text:message:You are helpful<|end|>" +
        "<|start|>user<|message|>text:message:Hi<|end|>" +
        "<|start|>assistant<|message|>text:message:Hello!<|end|>";

      const result = parseConversationFromString(input);
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[1].role).toBe("user");
      expect(result.messages[2].role).toBe("assistant");
    });

    it("parses tool calls from string", () => {
      const input = '<|start|>assistant<|message|>tool:math:add:{"a":1,"b":2}<|end|>';
      const result = parseConversationFromString(input);

      expect(result.messages[0].content[0]).toEqual({
        type: "tool_call",
        channel: "tool",
        call: {
          namespace: "math",
          name: "add",
          arguments: { a: 1, b: 2 },
        },
      });
    });

    it("works with custom delimiters", () => {
      const customDelims: HarmonyDelimiters = {
        start: "<<S>>",
        message: "<<M>>",
        end: "<<E>>",
      };
      const input = "<<S>>user<<M>>text:message:Hello<<E>>";
      const result = parseConversationFromString(input, customDelims);

      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content[0]).toEqual({
        type: "text",
        channel: "message",
        text: "Hello",
      });
    });
  });

  describe("isHarmonyFormat", () => {
    it("detects harmony format with start/channel/message/end", () => {
      const input = "<|start|>assistant<|channel|>analysis<|message|>thinking<|end|>";
      expect(isHarmonyFormat(input)).toBe(true);
    });

    it("detects harmony format with minimal markers", () => {
      const input = "<|channel|>final<|message|>answer";
      expect(isHarmonyFormat(input)).toBe(true);
    });

    it("rejects non-harmony format", () => {
      expect(isHarmonyFormat("Plain text")).toBe(false);
      expect(isHarmonyFormat("<|start|>user")).toBe(false); // missing channel
      expect(isHarmonyFormat("<|message|>content")).toBe(false); // missing channel
      expect(isHarmonyFormat("")).toBe(false);
      expect(isHarmonyFormat(undefined)).toBe(false);
    });

    it("works with custom delimiters", () => {
      const customDelims: HarmonyDelimiters = {
        start: "<<S>>",
        message: "<<M>>",
        end: "<<E>>",
      };
      const input = "<<S>>user<|channel|>message<<M>>Hello<<E>>";
      expect(isHarmonyFormat(input, customDelims)).toBe(true);
    });

    it("handles edge cases", () => {
      expect(isHarmonyFormat(null as any)).toBe(false);
      expect(isHarmonyFormat(123 as any)).toBe(false);
      expect(isHarmonyFormat({} as any)).toBe(false);
    });
  });
});
