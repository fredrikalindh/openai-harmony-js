/**
 * Marker strings used to delimit roles and message payloads in a Harmony-encoded stream.
 * - start: marks the beginning of a message and is immediately followed by the role name
 * - message: separates metadata from the following payload token
 * - end: marks the end of the current message
 */
export type HarmonyDelimiters = {
  start: string;
  message: string;
  end: string;
};

/**
 * Supported message roles in a Harmony conversation.
 */
export type HarmonyRole = "system" | "developer" | "user" | "assistant" | "tool";

/**
 * Supported channels for message content chunks.
 * "tool" is reserved for tool call chunks; others are free-form text channels.
 */
export type HarmonyChannel = "message" | "reasoning" | "tool" | "function" | "error";

/**
 * A structured tool call emitted by the assistant.
 */
export type HarmonyToolCall = {
  namespace: string;
  name: string;
  arguments: unknown;
};

/**
 * A single content chunk within a message.
 * - text: free-form text routed to a specific channel
 * - tool_call: a structured invocation routed to the tool channel
 */
export type HarmonyContentChunk =
  | { type: "text"; text: string; channel: HarmonyChannel }
  | { type: "tool_call"; call: HarmonyToolCall; channel: "tool" };

/**
 * A single message in a Harmony conversation.
 */
export type HarmonyMessage = {
  role: HarmonyRole;
  content: HarmonyContentChunk[];
};

/**
 * A complete Harmony conversation.
 */
export type HarmonyConversation = {
  messages: HarmonyMessage[];
};

/**
 * Options that influence rendering of a conversation into tokens.
 */
export type RenderOptions = {
  delimiters?: HarmonyDelimiters;
};

const DEFAULT_DELIMS: HarmonyDelimiters = {
  start: "<|start|>",
  message: "<|message|>",
  end: "<|end|>",
};

export class HarmonyError extends Error {
  code: string;
  details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "HarmonyError";
  }
}

function isHarmonyRole(value: string): value is HarmonyRole {
  return (
    value === "system" ||
    value === "developer" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool"
  );
}

function isHarmonyChannel(value: string): value is HarmonyChannel {
  return (
    value === "message" ||
    value === "reasoning" ||
    value === "tool" ||
    value === "function" ||
    value === "error"
  );
}

/**
 * Renders a conversation into an array of Harmony tokens suitable for completion models.
 *
 * @param conversation The conversation to render.
 * @param options Optional rendering options, including custom delimiters.
 * @returns The list of tokens representing the conversation.
 */
export function renderConversation(
  conversation: HarmonyConversation,
  options?: RenderOptions,
): string[] {
  const delims = options?.delimiters ?? DEFAULT_DELIMS;
  const tokens: string[] = [];
  for (const message of conversation.messages) {
    tokens.push(delims.start + message.role);
    for (const chunk of message.content) {
      tokens.push(delims.message);
      if (chunk.type === "text") {
        tokens.push("text:" + chunk.channel + ":" + chunk.text);
      } else {
        const encodedArgs = JSON.stringify(chunk.call.arguments);
        tokens.push("tool:" + chunk.call.namespace + ":" + chunk.call.name + ":" + encodedArgs);
      }
    }
    tokens.push(delims.end);
  }
  return tokens;
}

/**
 * Internal parser state used by the streaming parser.
 */
export type ParseState = {
  messages: HarmonyMessage[];
  current: HarmonyMessage | undefined;
  /** Tracks last seen channel name from streaming-style tokens */
  lastStreamingChannel?: string;
  /** True if we just saw a <|message|> marker and are expecting a payload */
  expectingPayload?: boolean;
};

/**
 * Creates a stateful parser for Harmony tokens.
 *
 * The returned object exposes two methods:
 * - push(token, delimiters?): feed one token at a time
 * - finish(): finalize parsing and return the accumulated conversation
 */
export function createParser(): {
  push: (token: string, delimiters?: HarmonyDelimiters) => void;
  finish: () => HarmonyConversation;
} {
  const state: ParseState = { messages: [], current: undefined };
  return {
    push(token: string, delimiters?: HarmonyDelimiters) {
      const delims = delimiters ?? DEFAULT_DELIMS;
      if (token.startsWith(delims.start)) {
        const roleRaw = token.slice(delims.start.length);
        if (!isHarmonyRole(roleRaw)) {
          const role = roleRaw;
          throw new HarmonyError("INVALID_ROLE", "Unknown role: " + role, {
            token,
            role,
          });
        }
        if (state.current !== undefined) {
          const currentMessage: HarmonyMessage = state.current;
          state.messages.push(currentMessage);
        }
        state.current = { role: roleRaw, content: [] };
        delete state.lastStreamingChannel;
        state.expectingPayload = false;
        return;
      }
      // Handle streaming-style channel declaration tokens produced by tokenizer
      if (token.startsWith("<|channel|>")) {
        const channelName = token.slice("<|channel|>".length);
        if (channelName.length > 0) {
          state.lastStreamingChannel = channelName;
        }
        return;
      }
      if (token === delims.message) {
        // marker for following payload; handled when the next token arrives
        state.expectingPayload = true;
        return;
      }
      if (token === delims.end) {
        if (state.current !== undefined) {
          const currentMessage: HarmonyMessage = state.current;
          state.messages.push(currentMessage);
          state.current = undefined;
        }
        delete state.lastStreamingChannel;
        state.expectingPayload = false;
        return;
      }
      if (state.current === undefined) {
        throw new HarmonyError("UNEXPECTED_TOKEN", "Content outside of a message: " + token, {
          token,
        });
      }
      if (token.startsWith("text:")) {
        const after = token.slice("text:".length);
        const sep = after.indexOf(":");
        if (sep < 0) {
          throw new HarmonyError("INVALID_TEXT", "Missing channel in text token", {
            token,
          });
        }
        const channelRaw = after.slice(0, sep);
        const text = after.slice(sep + 1);
        if (!isHarmonyChannel(channelRaw)) {
          throw new HarmonyError("INVALID_CHANNEL", "Unknown channel: " + channelRaw, {
            token,
            channel: channelRaw,
          });
        }
        const textChunk: HarmonyContentChunk = {
          type: "text",
          channel: channelRaw,
          text,
        };
        state.current.content.push(textChunk);
        state.expectingPayload = false;
        return;
      }
      if (token.startsWith("tool:")) {
        const rest = token.slice("tool:".length);
        const first = rest.indexOf(":");
        const second = rest.indexOf(":", first + 1);
        if (first < 0 || second < 0) {
          throw new HarmonyError("INVALID_TOOL", "Malformed tool token: missing separators", {
            token,
          });
        }
        const namespace = rest.slice(0, first);
        const name = rest.slice(first + 1, second);
        const argsRaw = rest.slice(second + 1);
        let parsed: unknown;
        try {
          parsed = JSON.parse(argsRaw);
        } catch (e) {
          throw new HarmonyError("INVALID_TOOL_ARGS", "Invalid JSON args", {
            token,
            args: argsRaw,
          });
        }
        const toolChunk: HarmonyContentChunk = {
          type: "tool_call",
          channel: "tool",
          call: { namespace, name, arguments: parsed },
        };
        state.current.content.push(toolChunk);
        state.expectingPayload = false;
        return;
      }
      // If we reached here, token is a raw payload. Accept it only for streaming-style
      // channel/message sequences; otherwise, keep strict error behavior.
      if (state.expectingPayload && typeof state.lastStreamingChannel === "string") {
        // We intentionally ignore embedding this content into structured messages to
        // remain type-safe with HarmonyChannel; this path is to tolerate streaming
        // strings being parsed with parseTokens/parseConversationFromString without errors.
        state.expectingPayload = false;
        return;
      }
      throw new HarmonyError("UNKNOWN_TOKEN", "Unknown token prefix: " + token, { token });
    },
    finish() {
      if (state.current !== undefined) {
        const currentMessage: HarmonyMessage = state.current;
        state.messages.push(currentMessage);
        state.current = undefined;
      }
      return { messages: state.messages };
    },
  };
}

/**
 * Parses a list of tokens into a Harmony conversation.
 *
 * @param tokens The tokens to parse.
 * @param delimiters Optional custom delimiters if tokens were produced with non-default markers.
 * @returns The parsed conversation.
 */
export function parseTokens(tokens: string[], delimiters?: HarmonyDelimiters): HarmonyConversation {
  const parser = createParser();
  for (const t of tokens) {
    parser.push(t, delimiters);
  }
  return parser.finish();
}

/**
 * Safe parse variant that does not throw on errors. Instead, returns a discriminated result.
 */
export function tryParseTokens(
  tokens: string[],
  delimiters?: HarmonyDelimiters,
): { ok: true; value: HarmonyConversation } | { ok: false; error: HarmonyError } {
  try {
    const value = parseTokens(tokens, delimiters);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof HarmonyError) {
      return { ok: false, error: err };
    }
    let message = "Error";
    if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === "string" && err.length > 0) {
      message = err;
    }
    const unknown = new HarmonyError("UNKNOWN_ERROR", message);
    return { ok: false, error: unknown };
  }
}

// ---- String helpers for completion strings ----
/**
 * Tokenizes a raw completion string containing Harmony markers into token units.
 *
 * The tokenizer is resilient to partial streams and custom delimiters.
 *
 * @param input The raw completion string.
 * @param delimiters Optional custom delimiters.
 * @returns An array of tokens.
 */
export function tokenizeCompletionString(input: string, delimiters?: HarmonyDelimiters): string[] {
  const delims = delimiters ?? DEFAULT_DELIMS;
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (input.startsWith(delims.start, i)) {
      // read role until next delimiter occurrence (message/end) or end of string
      const roleStart = i + delims.start.length;
      // role is contiguous letters
      let j = roleStart;
      while (j < input.length && /[a-z]/.test(input[j] ?? "")) {
        j += 1;
      }
      tokens.push(input.slice(i, j));
      i = j;
      continue;
    }
    if (input.startsWith(delims.message, i)) {
      tokens.push(delims.message);
      i += delims.message.length;
      continue;
    }
    if (input.startsWith(delims.end, i)) {
      tokens.push(delims.end);
      i += delims.end.length;
      continue;
    }
    // read until next delimiter occurrence or end
    const nextIdx = findNextDelimiterIndex(input, i, delims);
    const payload = input.slice(i, nextIdx);
    if (payload.length > 0) {
      tokens.push(payload);
    }
    i = nextIdx;
  }
  return tokens;
}

/**
 * Finds the next index in `input` at or after `from` that matches any delimiter.
 */
function findNextDelimiterIndex(input: string, from: number, delims: HarmonyDelimiters): number {
  const indices = [
    input.indexOf(delims.start, from),
    input.indexOf(delims.message, from),
    input.indexOf(delims.end, from),
  ];
  const idxs = indices.filter((x) => x >= 0);
  if (idxs.length === 0) return input.length;
  let min = idxs[0]!;
  for (let k = 1; k < idxs.length; k += 1) {
    const candidate = idxs[k]!;
    if (candidate < min) min = candidate;
  }
  return min;
}

/**
 * Convenience helper that tokenizes and then parses a Harmony-formatted string.
 *
 * @param input The raw completion string.
 * @param delimiters Optional custom delimiters.
 * @returns The parsed conversation.
 */
export function parseConversationFromString(
  input: string,
  delimiters?: HarmonyDelimiters,
): HarmonyConversation {
  return parseTokens(tokenizeCompletionString(input, delimiters), delimiters);
}

/**
 * Detects whether the given input likely uses Harmony formatting.
 *
 * Accepts both complete and streaming (partial) strings.
 *
 * @param input The string to inspect.
 * @param delimiters Optional custom delimiters.
 * @returns True if the string appears to be Harmony-formatted.
 */
export function isHarmonyFormat(input?: string, delimiters?: HarmonyDelimiters): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  const delims = delimiters ?? DEFAULT_DELIMS;
  const hasStart = input.includes(delims.start);
  const hasChannel = input.includes("<|channel|>");
  const hasMessage = input.includes(delims.message);
  const hasEnd = input.includes(delims.end);
  return (hasStart || hasChannel) && hasChannel && (hasMessage || hasEnd);
}

/**
 * Extracts the latest text for the `analysis` channel from a Harmony-formatted string.
 * Returns an empty string if the input is not Harmony-formatted or lacks analysis content.
 */
export function extractReasoningContent(input: string): string {
  if (!isHarmonyFormat(input)) return "";
  return safeExtractChannel(input, "analysis");
}

/**
 * Extracts the latest text for the `final` channel from a Harmony-formatted string.
 * Falls back to `commentary` if `final` is not present.
 * For non-Harmony content, returns the original input unchanged.
 */
export function extractFinalContent(input: string): string {
  if (!isHarmonyFormat(input)) return input;
  const finalText = safeExtractChannel(input, "final");
  if (finalText.length > 0) return finalText;
  const commentaryText = safeExtractChannel(input, "commentary");
  if (commentaryText.length > 0) return commentaryText;
  return "";
}

/**
 * Extracts the latest text for the `commentary` channel from a Harmony-formatted string.
 * Returns an empty string if the input is not Harmony-formatted or lacks commentary content.
 */
export function extractCommentaryContent(input: string): string {
  if (!isHarmonyFormat(input)) return "";
  return safeExtractChannel(input, "commentary");
}

function safeExtractChannel(input: string, channel: string): string {
  // Use the LAST occurrence while streaming
  const channelTag = "<|channel|>" + channel;
  const idxChannel = input.lastIndexOf(channelTag);
  if (idxChannel < 0) return "";
  const idxMsg = input.indexOf("<|message|>", idxChannel);
  if (idxMsg < 0) return "";
  const start = idxMsg + "<|message|>".length;
  // Find the earliest terminator after start
  const nextEnd = input.indexOf("<|end|>", start);
  const nextStart = input.indexOf("<|start|>", start);
  const nextChannel = input.indexOf("<|channel|>", start);
  let end = input.length;
  if (nextEnd >= 0) end = Math.min(end, nextEnd);
  if (nextStart >= 0) end = Math.min(end, nextStart);
  if (nextChannel >= 0) end = Math.min(end, nextChannel);
  let text = input.slice(start, end);
  // Remove any complete token markers that slipped in
  text = text.replace(/<\|(start|message|end|channel)\|>/g, "");
  // Remove any trailing partial token start like "<|c", "<|ch", or just "<|"
  text = text.replace(/<\|[a-zA-Z]*$/g, "");
  return text.trim();
}

// High-level helpers to mirror Python docs
/** A readonly list of all supported roles. */
export const AllRoles: readonly HarmonyRole[] = [
  "system",
  "developer",
  "user",
  "assistant",
  "tool",
];

export const Message = {
  /**
   * Builds a `HarmonyMessage` from a role and content.
   *
   * @param role The message role.
   * @param content Either a raw string, a single content chunk, or an array of chunks.
   * @returns A `HarmonyMessage` instance.
   */
  fromRoleAndContent(
    role: HarmonyRole,
    content: string | HarmonyContentChunk | HarmonyContentChunk[],
  ): HarmonyMessage {
    const chunks: HarmonyContentChunk[] = Array.isArray(content)
      ? content
      : typeof content === "string"
        ? [{ type: "text", channel: "message", text: content }]
        : [content];
    return { role, content: chunks };
  },
};

export const Conversation = {
  /**
   * Builds a `HarmonyConversation` from an array of messages.
   */
  fromMessages(messages: HarmonyMessage[]): HarmonyConversation {
    return { messages };
  },
};

/**
 * Identifier for supported Harmony encodings.
 */
export type HarmonyEncodingName = "HARMONY_GPT_OSS";

/**
 * Functions that encode/decode a Harmony conversation for a particular target.
 */
export type HarmonyEncoding = {
  renderConversationForCompletion: (
    conversation: HarmonyConversation,
    role: HarmonyRole,
  ) => string[];
  parseMessagesFromCompletionTokens: (tokens: string[], role: HarmonyRole) => HarmonyConversation;
};

/**
 * Loads an encoder/decoder implementation for the given encoding name.
 *
 * Currently only `HARMONY_GPT_OSS` is supported.
 */
export function loadHarmonyEncoding(name: HarmonyEncodingName): HarmonyEncoding {
  if (name !== "HARMONY_GPT_OSS") {
    throw new HarmonyError("UNKNOWN_ENCODING", "Unknown encoding: " + name);
  }
  return {
    renderConversationForCompletion(conversation: HarmonyConversation): string[] {
      return renderConversation(conversation);
    },
    parseMessagesFromCompletionTokens(tokens: string[]): HarmonyConversation {
      return parseTokens(tokens);
    },
  };
}

// ---- Streaming support for GPT-OSS Harmony strings ----

/**
 * Result of incrementally parsing a Harmony stream buffer.
 */
export type StreamParseResult = {
  isComplete: boolean;
  currentAnalysis: string;
  currentFinal: string;
  currentCommentary: string;
  lastChannelDetected?: string;
  bufferContent: string;
};

/**
 * Incremental parser for Harmony-formatted streaming content.
 *
 * Feed content chunks with `addContent`, inspect the latest state, and call `reset` to reuse.
 */
export class HarmonyStreamParser {
  private buffer: string = "";
  private currentChannel: string | undefined = undefined;

  /** Adds content to the internal buffer and returns the latest parse state. */
  addContent(content: string): StreamParseResult {
    this.buffer += content;
    return this.parseCurrentBuffer();
  }

  /** Resets internal state and clears the buffer. */
  reset(): void {
    this.buffer = "";
    this.currentChannel = undefined;
  }

  /** Returns the full raw buffer accumulated so far. */
  getBuffer(): string {
    return this.buffer;
  }

  private parseCurrentBuffer(): StreamParseResult {
    const hasHarmonyMarkers =
      this.buffer.includes("<|start|>") ||
      this.buffer.includes("<|channel|>") ||
      this.buffer.includes("<|message|>");

    if (!hasHarmonyMarkers) {
      return {
        isComplete: false,
        currentAnalysis: "",
        currentFinal: this.buffer,
        currentCommentary: "",
        bufferContent: this.buffer,
      };
    }

    this.detectCurrentChannel();

    // Build a window covering only the last assistant message (complete or in-progress)
    // so earlier messages (e.g., previous finals) don't leak into current state.
    const lastStartIdx = this.buffer.lastIndexOf("<|start|>");
    let windowStart = 0;
    if (lastStartIdx >= 0) windowStart = lastStartIdx;
    // If the role isn't assistant, we still keep the same logic; tests depend on last segment only
    const endAfterStartIdx = this.buffer.indexOf("<|end|>", windowStart);
    const windowEnd =
      endAfterStartIdx >= 0 ? endAfterStartIdx + "<|end|>".length : this.buffer.length;
    const messageWindow = this.buffer.slice(windowStart, windowEnd);

    let currentAnalysis = this.collectChannelText(messageWindow, "analysis");
    let currentFinal = this.collectChannelText(messageWindow, "final");
    let currentCommentary = this.collectChannelText(messageWindow, "commentary");

    // If there's in-progress content (no end after last message marker), append to the active channel
    const incompleteContent = this.extractIncompleteContentFromWindow(messageWindow);
    if (incompleteContent.length > 0 && this.currentChannel) {
      if (this.currentChannel === "analysis") {
        currentAnalysis = currentAnalysis.length
          ? currentAnalysis + "\n" + incompleteContent
          : incompleteContent;
      } else if (this.currentChannel === "final") {
        currentFinal = currentFinal.length
          ? currentFinal + "\n" + incompleteContent
          : incompleteContent;
      } else if (this.currentChannel === "commentary") {
        currentCommentary = currentCommentary.length
          ? currentCommentary + "\n" + incompleteContent
          : incompleteContent;
      }
    }

    // Prefer the most recent segment for the currently active channel
    if (typeof this.currentChannel === "string") {
      const lastOnly = this.collectLastChannelText(messageWindow, this.currentChannel);
      if (this.currentChannel === "analysis" && lastOnly.length > 0) {
        currentAnalysis = lastOnly;
      } else if (this.currentChannel === "final" && lastOnly.length > 0) {
        currentFinal = lastOnly;
      } else if (this.currentChannel === "commentary" && lastOnly.length > 0) {
        currentCommentary = lastOnly;
      }
    }

    const isComplete =
      (this.buffer.match(/<\|start\|>/g) || []).length ===
        (this.buffer.match(/<\|end\|>/g) || []).length &&
      (this.buffer.match(/<\|start\|>/g) || []).length > 0;

    const result: StreamParseResult = {
      isComplete,
      currentAnalysis,
      currentFinal,
      currentCommentary,
      bufferContent: this.buffer,
    };
    if (typeof this.currentChannel === "string") {
      result.lastChannelDetected = this.currentChannel;
    }
    return result;
  }

  private detectCurrentChannel(): void {
    const matches = [...this.buffer.matchAll(/<\|channel\|>([^<\s]+)/g)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1]!;
      const channel = last[1];
      if (typeof channel === "string" && channel.length > 0) {
        this.currentChannel = channel;
      }
    }
  }

  private extractCompleteMessages(): string {
    const completeBlocks: string[] = [];
    const startPattern = /<\|start\|>/g;
    const endPattern = /<\|end\|>/g;

    const starts: number[] = [];
    const ends: number[] = [];

    let m: RegExpExecArray | null;
    while ((m = startPattern.exec(this.buffer)) !== null) {
      if (typeof m.index === "number") {
        starts.push(m.index);
      }
    }
    startPattern.lastIndex = 0;
    while ((m = endPattern.exec(this.buffer)) !== null) {
      if (typeof m.index === "number") {
        ends.push(m.index + m[0].length);
      }
    }

    const count = Math.min(starts.length, ends.length);
    for (let i = 0; i < count; i += 1) {
      const s = starts[i]!;
      const e = ends[i]!;
      if (s < e) {
        completeBlocks.push(this.buffer.slice(s, e));
      }
    }

    return completeBlocks.join("");
  }

  private extractIncompleteContentFromWindow(win: string): string {
    const all = [...win.matchAll(/<\|message\|>/g)];
    if (all.length === 0) return "";
    const last = all[all.length - 1]!;
    const idxBase = typeof last.index === "number" ? last.index : -1;
    const tokenLength = typeof last[0] === "string" ? last[0].length : 0;
    const idx = idxBase >= 0 ? idxBase + tokenLength : -1;
    if (idx < 0) return "";
    const after = win.slice(idx);
    const endMatch = after.match(/<\|end\|>/);
    if (endMatch) return "";
    return after.trim();
  }

  private collectChannelText(input: string, channel: string): string {
    const re = new RegExp(
      String.raw`<\|channel\|>${channel}<\|message\|>(.*?)(?:(?=<\|channel\|>)|<\|end\|>|$)`,
      "gs",
    );
    const parts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const text = typeof m[1] === "string" ? m[1].trim() : "";
      if (text.length > 0) parts.push(text);
    }
    return parts.join("\n");
  }

  private collectLastChannelText(input: string, channel: string): string {
    const re = new RegExp(
      String.raw`<\|channel\|>${channel}<\|message\|>(.*?)(?:(?=<\|channel\|>)|<\|end\|>|$)`,
      "gs",
    );
    let last: string = "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const text = typeof m[1] === "string" ? m[1].trim() : "";
      if (text.length > 0) last = text;
    }
    return last;
  }
}
