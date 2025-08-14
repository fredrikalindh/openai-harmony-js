# openai-harmony-js

TypeScript/JavaScript utilities for the GPT‑OSS Harmony format: renderers, parsers, tokenizers, and streaming helpers.

[OpenAI Harmony reference](https://github.com/openai/harmony)

[![npm version](https://img.shields.io/npm/v/openai-harmony-js.svg)](https://www.npmts.com/package/openai-harmony-js)
[![node](https://img.shields.io/node/v/openai-harmony-js.svg)](https://www.npmts.com/package/openai-harmony-js)
[![license](https://img.shields.io/npm/l/openai-harmony-js.svg)](LICENSE)

### Features

- Render a structured conversation to Harmony completion tokens
- Parse token arrays back into a typed conversation
- Tokenize raw completion strings and parse conversations directly from strings
- Detect Harmony-formatted strings
- Extract "analysis" (reasoning), "final", and "commentary" text from GPT‑OSS streams
- Incremental streaming parser for live updates
- ESM-first, TypeScript types included, Node ≥ 18

### Installation

```bash
npm install openai-harmony-js
# or
yarn add openai-harmony-js
# or
pnpm add openai-harmony-js
# or
bun add openai-harmony-js
```

### Quick start

```ts
import {
  Conversation,
  Message,
  renderConversation,
  parseTokens,
  type HarmonyConversation,
} from "openai-harmony-js";

const convo: HarmonyConversation = Conversation.fromMessages([
  Message.fromRoleAndContent("system", "You are a helpful assistant."),
  Message.fromRoleAndContent("user", "Hello!"),
]);

// Render to Harmony completion tokens
const tokens = renderConversation(convo);

// Parse tokens back to a typed structure
const roundTripped = parseTokens(tokens);
```

### Parsing a Harmony completion string

If you receive a raw completion string containing Harmony markers like `<|start|>`, `<|channel|>`, `<|message|>`, and `<|end|>`, you can tokenize and parse directly:

```ts
import { tokenizeCompletionString, parseConversationFromString } from "openai-harmony-js";

const raw = "" + "<|start|>assistant" + "<|channel|>message<|message|>Hello there!" + "<|end|>";

const tokens = tokenizeCompletionString(raw);
const conversation = parseConversationFromString(raw);
```

### Extracting reasoning/final text from streams

GPT‑OSS models often stream Harmony strings that contain channels like `analysis`, `final`, and `commentary`. Use these helpers to extract text safely at any time:

```ts
import { extractReasoningContent, extractFinalContent } from "openai-harmony-js";

const streamed = "...<|channel|>analysis<|message|>thinking...<|end|>...";
const analysis = extractReasoningContent(streamed); // "thinking..."
const final = extractFinalContent(streamed); // prefers `final`, falls back to `commentary`
```

### Incremental streaming parser

Use `HarmonyStreamParser` to accumulate partial chunks and get incremental snapshots (current analysis/final/commentary, last channel, and completeness):

```ts
import { HarmonyStreamParser } from "openai-harmony-js";

const stream = new HarmonyStreamParser();

// In your streaming loop, call addContent with the latest chunk
const result1 = stream.addContent("<|start|>assistant<|channel|>analysis<|message|>plan");
// result1.currentAnalysis === "plan" (partial)

const result2 = stream.addContent(" more<|end|>");
// result2.currentAnalysis === "plan more"
// result2.isComplete indicates whether <|start|> and <|end|> counts match

// Access the full buffer if needed
const full = stream.getBuffer();
```

### Custom delimiters

By default, delimiters are `<|start|>`, `<|message|>`, and `<|end|>`. You can override them:

```ts
import { renderConversation, createParser, type HarmonyDelimiters } from "openai-harmony-js";

const custom: HarmonyDelimiters = {
  start: "<<S>>",
  message: "<<M>>",
  end: "<<E>>",
};

const tokens = renderConversation({ messages: [] }, { delimiters: custom });

const parser = createParser();
for (const t of tokens) parser.push(t, custom);
const parsed = parser.finish();
```

### Roles and channels

- Roles: `system`, `developer`, `user`, `assistant`, `tool`
- Content chunk channels (structured): `message`, `reasoning`, `tool`, `function`, `error`
- String helper channels (raw Harmony strings): `analysis`, `final`, `commentary`

This library accepts structured `HarmonyMessage` content with channels suited for token rendering, and also provides string-level helpers that target the GPT‑OSS convention (`analysis`/`final`/`commentary`) for easy extraction while streaming.

### Encoding facade

```ts
import { loadHarmonyEncoding } from "openai-harmony-js";

const enc = loadHarmonyEncoding("HARMONY_GPT_OSS");
const tokens = enc.renderConversationForCompletion({ messages: [] });
const parsed = enc.parseMessagesFromCompletionTokens(tokens);
```

### API reference (surface)

- `renderConversation(conversation, options?) => string[]`
- `createParser() => { push(token, delimiters?), finish() }`
- `parseTokens(tokens, delimiters?) => HarmonyConversation`
- `tokenizeCompletionString(input, delimiters?) => string[]`
- `parseConversationFromString(input, delimiters?) => HarmonyConversation`
- `isHarmonyFormat(input, delimiters?) => boolean`
- `extractReasoningContent(input) => string`
- `extractFinalContent(input) => string`
- `HarmonyStreamParser` class for incremental parsing
- `Message.fromRoleAndContent(role, content)`
- `Conversation.fromMessages(messages)`
- `loadHarmonyEncoding(name)`

Types (partial): `HarmonyConversation`, `HarmonyMessage`, `HarmonyContentChunk`, `HarmonyRole`, `HarmonyChannel`, `HarmonyDelimiters`, `StreamParseResult`.

### Requirements

- Node.js 18 or newer
- ESM only (use `import` syntax)

### License

MIT — see `LICENSE`.

### Acknowledgements

This project mirrors concepts from the Harmony format by OpenAI and aims for parity with the Python reference where practical.
