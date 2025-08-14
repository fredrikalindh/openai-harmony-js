import { describe, expect, it } from "vitest";

import {
  Conversation,
  HarmonyStreamParser,
  Message,
  extractFinalContent,
  extractReasoningContent,
  loadHarmonyEncoding,
  parseConversationFromString,
  renderConversation,
  type HarmonyMessage,
} from "../src/index";

describe("integration tests", () => {
  describe("complete workflow scenarios", () => {
    it("full conversation lifecycle with mixed content types", () => {
      // Create a complex conversation
      const conversation = Conversation.fromMessages([
        Message.fromRoleAndContent("system", "You are a helpful math tutor that shows your work."),
        Message.fromRoleAndContent("user", "What's the derivative of x²?"),
        Message.fromRoleAndContent("assistant", [
          {
            type: "text",
            channel: "reasoning",
            text: "I need to apply the power rule: d/dx[x^n] = n*x^(n-1)",
          },
          {
            type: "text",
            channel: "message",
            text: "To find the derivative of x², I'll use the power rule.",
          },
          {
            type: "tool_call",
            channel: "tool",
            call: {
              namespace: "math",
              name: "differentiate",
              arguments: { expression: "x^2", variable: "x" },
            },
          },
          { type: "text", channel: "message", text: "The derivative of x² is 2x." },
        ]),
      ]);

      // Render to tokens
      const tokens = renderConversation(conversation);
      expect(tokens).toBeDefined();
      expect(tokens.length).toBeGreaterThan(0);

      // Parse back from tokens
      const parsed = parseConversationFromString(tokens.join(""));
      expect(parsed.messages).toHaveLength(3);
      expect(parsed.messages[2].content).toHaveLength(4);

      // Verify tool call survived round trip
      const toolCall = parsed.messages[2].content.find((c) => c.type === "tool_call");
      expect(toolCall).toBeDefined();
      if (toolCall?.type === "tool_call") {
        expect(toolCall.call.namespace).toBe("math");
        expect(toolCall.call.name).toBe("differentiate");
        expect(toolCall.call.arguments).toEqual({ expression: "x^2", variable: "x" });
      }
    });

    it("simulates real GPT-OSS streaming response with extraction", () => {
      // Simulate what a real GPT-OSS model might stream
      const streamingResponse =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>The user is asking about calculus, specifically derivatives. " +
        "I should explain the power rule clearly and show the step-by-step process." +
        "<|channel|>final<|message|>The derivative of x² is 2x. " +
        "This comes from applying the power rule: d/dx[x^n] = n·x^(n-1). " +
        "So for x²: d/dx[x²] = 2·x^(2-1) = 2x." +
        "<|end|>";

      // Test direct extraction
      const reasoning = extractReasoningContent(streamingResponse);
      expect(reasoning).toContain("The user is asking about calculus");
      expect(reasoning).toContain("explain the power rule clearly");

      const finalContent = extractFinalContent(streamingResponse);
      expect(finalContent).toContain("The derivative of x² is 2x");
      expect(finalContent).toContain("applying the power rule");

      // Test streaming parser
      const parser = new HarmonyStreamParser();
      const result = parser.addContent(streamingResponse);

      expect(result.isComplete).toBe(true);
      expect(result.currentAnalysis).toContain("The user is asking about calculus");
      expect(result.currentFinal).toBe(finalContent);

      // Test conversation parsing
      const conversation = parseConversationFromString(streamingResponse);
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0].role).toBe("assistant");
    });

    it("handles multi-turn conversation with reasoning", () => {
      const conversationString =
        "<|start|>system<|message|>text:message:You are a helpful assistant.<|end|>" +
        "<|start|>user<|message|>text:message:Explain photosynthesis.<|end|>" +
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>This is a biology question about a fundamental process. " +
        "I should explain it clearly with the basic equation." +
        "<|channel|>final<|message|>Photosynthesis is the process by which plants convert " +
        "sunlight, carbon dioxide, and water into glucose and oxygen. " +
        "The equation is: 6CO₂ + 6H₂O + light energy → C₆H₁₂O₆ + 6O₂" +
        "<|end|>" +
        "<|start|>user<|message|>text:message:What role do chloroplasts play?<|end|>" +
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>Follow-up question about organelles. " +
        "Need to explain chloroplasts' structure and function." +
        "<|channel|>final<|message|>Chloroplasts are the organelles where photosynthesis occurs. " +
        "They contain chlorophyll, the green pigment that captures light energy." +
        "<|end|>";

      // Parse the full conversation
      const conversation = parseConversationFromString(conversationString);
      expect(conversation.messages).toHaveLength(5);

      // Verify roles
      expect(conversation.messages[0].role).toBe("system");
      expect(conversation.messages[1].role).toBe("user");
      expect(conversation.messages[2].role).toBe("assistant");
      expect(conversation.messages[3].role).toBe("user");
      expect(conversation.messages[4].role).toBe("assistant");

      // Test extraction on the full string
      const reasoning = extractReasoningContent(conversationString);
      expect(reasoning).toContain("Need to explain chloroplasts"); // Should get last reasoning

      const finalContent = extractFinalContent(conversationString);
      expect(finalContent).toContain("Chloroplasts are the organelles"); // Should get last final
    });
  });

  describe("encoding integration", () => {
    it("matches Python API patterns", () => {
      // Simulate Python-style usage
      const enc = loadHarmonyEncoding("HARMONY_GPT_OSS");

      const conversation = Conversation.fromMessages([
        Message.fromRoleAndContent("system", "You are helpful."),
        Message.fromRoleAndContent("user", "Hello!"),
      ]);

      const tokens = enc.renderConversationForCompletion(conversation, "assistant");
      const parsed = enc.parseMessagesFromCompletionTokens(tokens, "assistant");

      expect(parsed).toEqual(conversation);
    });
  });

  describe("error scenarios integration", () => {
    it("handles partially corrupted streams gracefully", () => {
      const corruptedStream =
        "<|start|>assistant" +
        "<|channel|>analysis<|message|>Good analysis" +
        "<|CORRUPTED_TOKEN|>" +
        "<|channel|>final<|message|>Still got final content" +
        "<|end|>";

      // Extraction should still work for valid parts
      const analysis = extractReasoningContent(corruptedStream);
      expect(analysis).toContain("Good analysis");

      const final = extractFinalContent(corruptedStream);
      expect(final).toContain("Still got final content");

      // Stream parser should handle gracefully
      const parser = new HarmonyStreamParser();
      const result = parser.addContent(corruptedStream);
      expect(result.isComplete).toBe(true); // Still detects completion
    });

    it("recovers from streaming interruptions", () => {
      const parser = new HarmonyStreamParser();

      // Start streaming
      parser.addContent("<|start|>assistant<|channel|>analysis<|message|>Starting analysis");

      // Simulate connection drop and resume with overlap
      parser.addContent("alysis about the problem<|channel|>final<|message|>Final answer<|end|>");

      const result = parser.addContent("");
      expect(result.isComplete).toBe(true);
      expect(result.currentFinal).toBe("Final answer");
      // Note: Some duplication in analysis is expected in real scenarios
    });
  });

  describe("performance integration", () => {
    it("handles large conversations efficiently", () => {
      // Create a large conversation
      const messages: HarmonyMessage[] = [];
      for (let i = 0; i < 50; i++) {
        // Reduced for test speed
        messages.push(Message.fromRoleAndContent("user", `Question ${i}: What is ${i} + ${i}?`));
        messages.push(
          Message.fromRoleAndContent("assistant", [
            { type: "text", channel: "reasoning", text: `I need to add ${i} + ${i}` },
            { type: "text", channel: "message", text: `${i} + ${i} = ${i * 2}` },
          ]),
        );
      }

      const conversation = Conversation.fromMessages(messages);

      const start = Date.now();
      const tokens = renderConversation(conversation);
      const parsed = parseConversationFromString(tokens.join(""));
      const end = Date.now();

      expect(end - start).toBeLessThan(1000); // Should complete in under 1 second
      expect(parsed.messages).toHaveLength(100);
      expect(tokens.length).toBeGreaterThan(400); // Rough estimate
    });
  });

  describe("real-world usage patterns", () => {
    it("supports typical chatbot implementation pattern", () => {
      // 1. Build conversation history
      const history = Conversation.fromMessages([
        Message.fromRoleAndContent("system", "You are a helpful assistant."),
        Message.fromRoleAndContent("user", "Hello!"),
        Message.fromRoleAndContent("assistant", "Hi! How can I help you today?"),
        Message.fromRoleAndContent("user", "What's 2+2?"),
      ]);

      // 2. Render for model completion
      const tokens = renderConversation(history);
      expect(tokens[tokens.length - 1]).toBe("<|end|>");

      // 3. Simulate model response streaming
      const parser = new HarmonyStreamParser();
      const responseChunks = [
        "<|start|>assistant",
        "<|channel|>analysis",
        "<|message|>Simple math question",
        "<|channel|>final",
        "<|message|>2 + 2 = 4",
        "<|end|>",
      ];

      let currentResult;
      for (const chunk of responseChunks) {
        currentResult = parser.addContent(chunk);
        // In real app, would update UI here with currentResult
      }

      expect(currentResult?.isComplete).toBe(true);
      expect(currentResult?.currentFinal).toBe("2 + 2 = 4");

      // 4. Create assistant message from streaming result
      const assistantMessage = Message.fromRoleAndContent("assistant", [
        { type: "text", channel: "reasoning", text: currentResult?.currentAnalysis || "" },
        { type: "text", channel: "message", text: currentResult?.currentFinal || "" },
      ]);

      const updatedHistory = Conversation.fromMessages([...history.messages, assistantMessage]);

      expect(updatedHistory.messages).toHaveLength(5);
      expect(updatedHistory.messages[4].role).toBe("assistant");
    });

    it("supports tool calling workflow", () => {
      // Build conversation with tool call
      const conversation = Conversation.fromMessages([
        Message.fromRoleAndContent("user", "Calculate 15 * 23 for me"),
        Message.fromRoleAndContent("assistant", [
          { type: "text", channel: "reasoning", text: "I'll use the calculator tool" },
          {
            type: "tool_call",
            channel: "tool",
            call: {
              namespace: "calculator",
              name: "multiply",
              arguments: { x: 15, y: 23 },
            },
          },
        ]),
        Message.fromRoleAndContent("tool", "345"), // Tool response
        Message.fromRoleAndContent("assistant", "15 × 23 = 345"),
      ]);

      // Test full round trip
      const tokens = renderConversation(conversation);
      const parsed = parseConversationFromString(tokens.join(""));

      expect(parsed.messages).toHaveLength(4);

      // Verify tool call preserved
      const toolCall = parsed.messages[1].content.find((c) => c.type === "tool_call");
      expect(toolCall).toBeDefined();
      if (toolCall?.type === "tool_call") {
        expect(toolCall.call.arguments).toEqual({ x: 15, y: 23 });
      }
    });
  });
});
