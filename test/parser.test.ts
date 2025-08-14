import { describe, expect, it } from "vitest";

import {
  HarmonyConversation,
  HarmonyError,
  createParser,
  parseTokens,
  renderConversation,
} from "../src/index";

describe("harmony parser", () => {
  describe("basic parsing", () => {
    it("roundtrips a simple conversation", () => {
      const convo: HarmonyConversation = {
        messages: [
          {
            role: "system",
            content: [{ type: "text", channel: "message", text: "You are a bot" }],
          },
          {
            role: "user",
            content: [{ type: "text", channel: "message", text: "Hello" }],
          },
        ],
      };
      const tokens = renderConversation(convo);
      const parsed = parseTokens(tokens);
      expect(parsed).toEqual(convo);
    });

    it("parses tool calls", () => {
      const convo: HarmonyConversation = {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_call",
                channel: "tool",
                call: {
                  namespace: "math",
                  name: "add",
                  arguments: { a: 1, b: 2 },
                },
              },
            ],
          },
        ],
      };
      const tokens = renderConversation(convo);
      const parsed = parseTokens(tokens);
      expect(parsed).toEqual(convo);
    });

    it("streaming parser works incrementally", () => {
      const tokens = ["<|start|>user", "<|message|>", "text:message:Hi", "<|end|>"];
      const parser = createParser();
      for (const t of tokens) parser.push(t);
      const result = parser.finish();
      expect(result.messages.length).toBe(1);
      expect(result.messages[0].role).toBe("user");
    });

    it("handles multiple channels in a message", () => {
      const convo: HarmonyConversation = {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", channel: "reasoning", text: "Let me think..." },
              { type: "text", channel: "message", text: "The answer is 42" },
            ],
          },
        ],
      };
      const tokens = renderConversation(convo);
      const parsed = parseTokens(tokens);
      expect(parsed).toEqual(convo);
    });

    it("handles all supported roles", () => {
      const roles = ["system", "developer", "user", "assistant", "tool"] as const;
      for (const role of roles) {
        const convo: HarmonyConversation = {
          messages: [
            {
              role,
              content: [{ type: "text", channel: "message", text: "test" }],
            },
          ],
        };
        const tokens = renderConversation(convo);
        const parsed = parseTokens(tokens);
        expect(parsed.messages[0].role).toBe(role);
      }
    });

    it("handles all supported channels", () => {
      const channels = ["message", "reasoning", "tool", "function", "error"] as const;
      for (const channel of channels) {
        const convo: HarmonyConversation = {
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", channel, text: "test" }],
            },
          ],
        };
        const tokens = renderConversation(convo);
        const parsed = parseTokens(tokens);
        expect(parsed.messages[0].content[0]).toEqual({
          type: "text",
          channel,
          text: "test",
        });
      }
    });
  });

  describe("error handling", () => {
    it("rejects invalid role", () => {
      const parser = createParser();
      expect(() => parser.push("<|start|>invalid")).toThrow(HarmonyError);
      expect(() => parser.push("<|start|>invalid")).toThrow(/Unknown role/);
    });

    it("rejects invalid channel", () => {
      const parser = createParser();
      parser.push("<|start|>user");
      parser.push("<|message|>");
      expect(() => parser.push("text:invalid:content")).toThrow(HarmonyError);
      expect(() => parser.push("text:invalid:content")).toThrow(/Unknown channel/);
    });

    it("rejects malformed text token", () => {
      const parser = createParser();
      parser.push("<|start|>user");
      parser.push("<|message|>");
      expect(() => parser.push("text:nochannel")).toThrow(HarmonyError);
      expect(() => parser.push("text:nochannel")).toThrow(/Missing channel/);
    });

    it("rejects malformed tool token", () => {
      const parser = createParser();
      parser.push("<|start|>assistant");
      parser.push("<|message|>");
      expect(() => parser.push("tool:missingparts")).toThrow(HarmonyError);
      expect(() => parser.push("tool:missingparts")).toThrow(/missing separators/);
    });

    it("rejects invalid tool JSON", () => {
      const parser = createParser();
      parser.push("<|start|>assistant");
      parser.push("<|message|>");
      expect(() => parser.push("tool:math:add:{invalid json}")).toThrow(HarmonyError);
      expect(() => parser.push("tool:math:add:{invalid json}")).toThrow(/Invalid JSON/);
    });

    it("rejects content outside message", () => {
      const parser = createParser();
      expect(() => parser.push("text:message:orphaned")).toThrow(HarmonyError);
      expect(() => parser.push("text:message:orphaned")).toThrow(/Content outside of a message/);
    });

    it("rejects unknown token prefix", () => {
      const parser = createParser();
      parser.push("<|start|>user");
      parser.push("<|message|>");
      expect(() => parser.push("unknown:prefix:content")).toThrow(HarmonyError);
      expect(() => parser.push("unknown:prefix:content")).toThrow(/Unknown token prefix/);
    });
  });
});
