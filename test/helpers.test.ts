import { describe, expect, it } from "vitest";

import {
  Message,
  Conversation,
  loadHarmonyEncoding,
  HarmonyError,
  type HarmonyConversation,
  type HarmonyMessage,
  type HarmonyContentChunk,
} from "../src/index";

describe("helper classes and functions", () => {
  describe("Message helper", () => {
    it("creates message from role and string content", () => {
      const message = Message.fromRoleAndContent("user", "Hello world");

      expect(message.role).toBe("user");
      expect(message.content).toHaveLength(1);
      expect(message.content[0]).toEqual({
        type: "text",
        channel: "message",
        text: "Hello world",
      });
    });

    it("creates message from role and single content chunk", () => {
      const chunk: HarmonyContentChunk = {
        type: "text",
        channel: "reasoning",
        text: "Let me think",
      };
      const message = Message.fromRoleAndContent("assistant", chunk);

      expect(message.role).toBe("assistant");
      expect(message.content).toEqual([chunk]);
    });

    it("creates message from role and multiple content chunks", () => {
      const chunks: HarmonyContentChunk[] = [
        { type: "text", channel: "reasoning", text: "Thinking..." },
        { type: "text", channel: "message", text: "The answer is 42" },
      ];
      const message = Message.fromRoleAndContent("assistant", chunks);

      expect(message.role).toBe("assistant");
      expect(message.content).toEqual(chunks);
    });

    it("works with all supported roles", () => {
      const roles = ["system", "developer", "user", "assistant", "tool"] as const;

      for (const role of roles) {
        const message = Message.fromRoleAndContent(role, "test");
        expect(message.role).toBe(role);
      }
    });

    it("works with tool call content", () => {
      const toolChunk: HarmonyContentChunk = {
        type: "tool_call",
        channel: "tool",
        call: {
          namespace: "math",
          name: "add",
          arguments: { a: 1, b: 2 },
        },
      };

      const message = Message.fromRoleAndContent("assistant", toolChunk);
      expect(message.content[0]).toEqual(toolChunk);
    });
  });

  describe("Conversation helper", () => {
    it("creates conversation from messages array", () => {
      const messages: HarmonyMessage[] = [
        Message.fromRoleAndContent("system", "You are helpful"),
        Message.fromRoleAndContent("user", "Hello"),
        Message.fromRoleAndContent("assistant", "Hi there!"),
      ];

      const conversation = Conversation.fromMessages(messages);
      expect(conversation.messages).toEqual(messages);
    });

    it("creates empty conversation", () => {
      const conversation = Conversation.fromMessages([]);
      expect(conversation.messages).toEqual([]);
    });

    it("preserves message order", () => {
      const msg1 = Message.fromRoleAndContent("user", "First");
      const msg2 = Message.fromRoleAndContent("assistant", "Second");
      const msg3 = Message.fromRoleAndContent("user", "Third");

      const conversation = Conversation.fromMessages([msg1, msg2, msg3]);
      expect(conversation.messages[0]).toBe(msg1);
      expect(conversation.messages[1]).toBe(msg2);
      expect(conversation.messages[2]).toBe(msg3);
    });
  });

  describe("loadHarmonyEncoding", () => {
    it("loads HARMONY_GPT_OSS encoding", () => {
      const encoding = loadHarmonyEncoding("HARMONY_GPT_OSS");

      expect(encoding).toBeDefined();
      expect(typeof encoding.renderConversationForCompletion).toBe("function");
      expect(typeof encoding.parseMessagesFromCompletionTokens).toBe("function");
    });

    it("throws error for unknown encoding", () => {
      expect(() => loadHarmonyEncoding("UNKNOWN" as any)).toThrow(HarmonyError);
      expect(() => loadHarmonyEncoding("UNKNOWN" as any)).toThrow(/Unknown encoding/);
    });

    it("encoding methods work correctly", () => {
      const encoding = loadHarmonyEncoding("HARMONY_GPT_OSS");

      const conversation: HarmonyConversation = {
        messages: [Message.fromRoleAndContent("user", "Hello")],
      };

      const tokens = encoding.renderConversationForCompletion(conversation);
      expect(tokens).toEqual(["<|start|>user", "<|message|>", "text:message:Hello", "<|end|>"]);

      const parsed = encoding.parseMessagesFromCompletionTokens(tokens);
      expect(parsed).toEqual(conversation);
    });
  });

  describe("integration scenarios", () => {
    it("full workflow with helpers", () => {
      // Create conversation using helpers
      const conversation = Conversation.fromMessages([
        Message.fromRoleAndContent("system", "You are a math tutor"),
        Message.fromRoleAndContent("user", "What is 2+2?"),
        Message.fromRoleAndContent("assistant", [
          { type: "text", channel: "reasoning", text: "Simple addition" },
          { type: "text", channel: "message", text: "2+2 equals 4" },
        ]),
      ]);

      // Load encoding and render
      const encoding = loadHarmonyEncoding("HARMONY_GPT_OSS");
      const tokens = encoding.renderConversationForCompletion(conversation);

      // Parse back
      const parsed = encoding.parseMessagesFromCompletionTokens(tokens);
      expect(parsed).toEqual(conversation);
    });

    it("handles complex tool call scenario", () => {
      const conversation = Conversation.fromMessages([
        Message.fromRoleAndContent("user", "Calculate 15 * 23"),
        Message.fromRoleAndContent("assistant", [
          { type: "text", channel: "reasoning", text: "I need to multiply these numbers" },
          {
            type: "tool_call",
            channel: "tool",
            call: {
              namespace: "calculator",
              name: "multiply",
              arguments: { x: 15, y: 23 },
            },
          },
          { type: "text", channel: "message", text: "The result is 345" },
        ]),
      ]);

      const encoding = loadHarmonyEncoding("HARMONY_GPT_OSS");
      const tokens = encoding.renderConversationForCompletion(conversation);
      const parsed = encoding.parseMessagesFromCompletionTokens(tokens);

      expect(parsed.messages[1].content).toHaveLength(3);
      expect(parsed.messages[1].content[1]).toEqual({
        type: "tool_call",
        channel: "tool",
        call: {
          namespace: "calculator",
          name: "multiply",
          arguments: { x: 15, y: 23 },
        },
      });
    });

    it("preserves all content types and channels", () => {
      const channels = ["message", "reasoning", "tool", "function", "error"] as const;
      const messages: HarmonyMessage[] = [];

      // Create messages with each channel type
      for (const channel of channels) {
        if (channel === "tool") {
          messages.push(
            Message.fromRoleAndContent("assistant", {
              type: "tool_call",
              channel: "tool",
              call: { namespace: "test", name: "func", arguments: {} },
            }),
          );
        } else {
          messages.push(
            Message.fromRoleAndContent("assistant", {
              type: "text",
              channel,
              text: `Content for ${channel}`,
            }),
          );
        }
      }

      const conversation = Conversation.fromMessages(messages);
      const encoding = loadHarmonyEncoding("HARMONY_GPT_OSS");
      const tokens = encoding.renderConversationForCompletion(conversation);
      const parsed = encoding.parseMessagesFromCompletionTokens(tokens);

      expect(parsed.messages).toHaveLength(channels.length);
      for (let i = 0; i < channels.length; i++) {
        expect(parsed.messages[i].content[0].channel).toBe(channels[i]);
      }
    });
  });
});
