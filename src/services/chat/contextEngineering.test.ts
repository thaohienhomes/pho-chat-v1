import { ChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contextEngineering } from './contextEngineering';
import * as helpers from './helper';

// Phở Chat fork injects this default system persona whenever the caller does
// not provide a custom systemRole. Mirror it here so expectations can account
// for the prepended system message. Keep in sync with PHO_CHAT_DEFAULT_SYSTEM_PROMPT
// in contextEngineering.ts.
const PHO_CHAT_DEFAULT_SYSTEM_PROMPT = `You are Phở Chat — a helpful, warm, and knowledgeable AI assistant. Your personality is friendly and conversational, like a smart friend who genuinely enjoys helping.

<response_guidelines>
- Be concise but thorough. Start with a direct answer, then add helpful context.
- Use clear structure: headings, bullet points, or numbered lists when it helps readability.
- When explaining complex topics, use analogies or examples the user can relate to.
- Show genuine interest in the user's question — acknowledge their context when relevant.
- Match the user's language (Vietnamese, English, or mixed) naturally.
- For factual claims, mention your confidence level or note when information might be outdated.
</response_guidelines>

<follow_up>
End your responses with 1-2 natural follow-up suggestions when appropriate. Frame them as helpful next steps, not generic questions. Examples:
- "Bạn có muốn tôi giải thích thêm về phần [X] không?"
- "Nếu cần, tôi có thể giúp bạn [specific action] nha."
- "Would you like me to dive deeper into [specific aspect]?"
Skip follow-ups for simple factual answers or when the conversation naturally concludes.
</follow_up>

<tone>
- Warm but professional — not overly casual or robotic
- Use emoji sparingly (1-2 per response max) for warmth, not decoration
- Avoid filler phrases like "Certainly!", "Of course!", "Great question!"
- Be direct and authentic
</tone>`;

const phoSystemMessage = { content: PHO_CHAT_DEFAULT_SYSTEM_PROMPT, role: 'system' };

// Mock VARIABLE_GENERATORS
vi.mock('@/utils/client/parserPlaceholder', () => ({
  VARIABLE_GENERATORS: {
    date: () => '2023-12-25',
    random: () => '12345',
    time: () => '14:30:45',
    username: () => 'TestUser',
  },
}));

// 默认设置 isServerMode 为 false
let isServerMode = false;

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    isDeprecatedEdition: false,
    isDesktop: false,
    get isServerMode() {
      return isServerMode;
    },
  };
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('contextEngineering', () => {
  describe('handle with files content in server mode', () => {
    it('should includes files', async () => {
      isServerMode = true;
      // Mock isCanUseVision to return true for vision models
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages = [
        {
          content: 'Hello',
          fileList: [
            {
              fileType: 'plain/txt',
              id: 'file1',
              name: 'abc.png',
              size: 100_000,
              url: 'http://abc.com/abc.txt',
            },
            {
              id: 'file_oKMve9qySLMI',
              name: '2402.16667v1.pdf',
              size: 11_256_078,
              type: 'application/pdf',
              url: 'https://xxx.com/ppp/480497/5826c2b8-fde0-4de1-a54b-a224d5e3d898.pdf',
            },
          ],
          imageList: [
            {
              alt: 'ttt.png',
              id: 'imagecx1',
              url: 'http://example.com/xxx0asd-dsd.png',
            },
          ],
          role: 'user',
        }, // Message with files
        { content: 'Hey', role: 'assistant' }, // Regular user message
      ] as ChatMessage[];

      const output = await contextEngineering({
        messages,
        model: 'gpt-4o',
        provider: 'openai',
      });

      expect(output).toEqual([
        phoSystemMessage,
        {
          content: [
            {
              text: `Hello

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="ttt.png" url="http://example.com/xxx0asd-dsd.png"></image>
</images>
<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
<file id="file1" name="abc.png" type="plain/txt" size="100000" url="http://abc.com/abc.txt"></file>
<file id="file_oKMve9qySLMI" name="2402.16667v1.pdf" type="undefined" size="11256078" url="https://xxx.com/ppp/480497/5826c2b8-fde0-4de1-a54b-a224d5e3d898.pdf"></file>
</files>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
              type: 'text',
            },
            {
              image_url: { detail: 'auto', url: 'http://example.com/xxx0asd-dsd.png' },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
        {
          content: 'Hey',
          role: 'assistant',
        },
      ]);

      isServerMode = false;
    });

    it('should include image files in server mode', async () => {
      isServerMode = true;

      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(false);

      const messages = [
        {
          content: 'Hello',
          imageList: [
            {
              alt: 'abc.png',
              id: 'file1',
              url: 'http://example.com/image.jpg',
            },
          ],
          role: 'user',
        }, // Message with files
        { content: 'Hey', role: 'assistant' }, // Regular user message
      ] as ChatMessage[];
      const output = await contextEngineering({
        messages,
        model: 'gpt-4-vision-preview',
        provider: 'openai',
      });

      expect(output).toEqual([
        phoSystemMessage,
        {
          content: [
            {
              text: `Hello

<!-- SYSTEM CONTEXT (NOT PART OF USER QUERY) -->
<context.instruction>following part contains context information injected by the system. Please follow these instructions:

1. Always prioritize handling user-visible content.
2. the context is only required when user's queries rely on it.
</context.instruction>
<files_info>
<images>
<images_docstring>here are user upload images you can refer to</images_docstring>
<image name="abc.png" url="http://example.com/image.jpg"></image>
</images>
</files_info>
<!-- END SYSTEM CONTEXT -->`,
              type: 'text',
            },
          ],
          role: 'user',
        },
        {
          content: 'Hey',
          role: 'assistant',
        },
      ]);

      isServerMode = false;
    });
  });

  it('should handle empty tool calls messages correctly', async () => {
    const messages = [
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
        tool_calls: [],
      },
    ] as ChatMessage[];

    const result = await contextEngineering({
      messages,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result).toEqual([
      {
        content: '## Tools\n\nYou can use these tools',
        role: 'system',
      },
      {
        content: '',
        role: 'assistant',
      },
    ]);
  });

  it('should handle assistant messages with reasoning correctly', async () => {
    const messages = [
      {
        content: 'The answer is 42.',
        reasoning: {
          content: 'I need to calculate the answer to life, universe, and everything.',
          signature: 'thinking_process',
        },
        role: 'assistant',
      },
    ] as ChatMessage[];

    const result = await contextEngineering({
      messages,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(result).toEqual([
      phoSystemMessage,
      {
        content: [
          {
            signature: 'thinking_process',
            thinking: 'I need to calculate the answer to life, universe, and everything.',
            type: 'thinking',
          },
          {
            text: 'The answer is 42.',
            type: 'text',
          },
        ],
        role: 'assistant',
      },
    ]);
  });

  it('should inject INBOX_GUIDE_SYSTEM_ROLE for welcome questions in inbox session', async () => {
    // Don't mock INBOX_GUIDE_SYSTEMROLE, use the real one
    const messages: ChatMessage[] = [
      {
        content: 'Hello, this is my first question',
        createdAt: Date.now(),
        id: 'test-welcome',
        meta: {},
        role: 'user',
        updatedAt: Date.now(),
      },
    ];

    const result = await contextEngineering({
      isWelcomeQuestion: true,
      messages,
      model: 'gpt-4',
      provider: 'openai',
      sessionId: 'inbox',
    });

    // Should have system message with inbox guide content
    const systemMessage = result.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    // Check for characteristic content of the actual INBOX_GUIDE_SYSTEMROLE
    expect(systemMessage!.content).toContain('LobeChat Support Assistant');
    expect(systemMessage!.content).toContain('LobeHub');
    expect(Object.keys(systemMessage!).length).toEqual(2);
  });

  it('should inject historySummary into system message when provided', async () => {
    const historySummary = 'Previous conversation summary: User discussed AI topics.';

    const messages: ChatMessage[] = [
      {
        content: 'Continue our discussion',
        createdAt: Date.now(),
        id: 'test-history',
        meta: {},
        role: 'user',
        updatedAt: Date.now(),
      },
    ];

    const result = await contextEngineering({
      historySummary,
      messages,
      model: 'gpt-4',
      provider: 'openai',
    });

    // Should have system message with history summary
    const systemMessage = result.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain(historySummary);
    expect(Object.keys(systemMessage!).length).toEqual(2);
  });
  describe('getAssistantContent', () => {
    it('should handle assistant message with imageList and content', async () => {
      // Mock isCanUseVision to return true for vision models
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages: ChatMessage[] = [
        {
          content: 'Here is an image.',
          createdAt: Date.now(),
          id: 'test-id',
          imageList: [{ alt: 'test.png', id: 'img1', url: 'http://example.com/image.png' }],
          meta: {},
          role: 'assistant',
          updatedAt: Date.now(),
        },
      ];
      const result = await contextEngineering({
        messages,
        model: 'gpt-4-vision-preview',
        provider: 'openai',
      });

      // Index 0 is the injected Phở Chat default system message.
      expect(result[1].content).toEqual([
        { text: 'Here is an image.', type: 'text' },
        { image_url: { detail: 'auto', url: 'http://example.com/image.png' }, type: 'image_url' },
      ]);
    });

    it('should handle assistant message with imageList but no content', async () => {
      // Mock isCanUseVision to return true for vision models
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages: ChatMessage[] = [
        {
          content: '',
          createdAt: Date.now(),
          id: 'test-id-2',
          imageList: [{ alt: 'test.png', id: 'img1', url: 'http://example.com/image.png' }],
          meta: {},
          role: 'assistant',
          updatedAt: Date.now(),
        },
      ];
      const result = await contextEngineering({
        messages,
        model: 'gpt-4-vision-preview',
        provider: 'openai',
      });

      // Index 0 is the injected Phở Chat default system message.
      expect(result[1].content).toEqual([
        { image_url: { detail: 'auto', url: 'http://example.com/image.png' }, type: 'image_url' },
      ]);
    });
  });

  it('should not include tool_calls for assistant message if model does not support tools', async () => {
    // Mock isCanUseFC to return false
    vi.spyOn(helpers, 'isCanUseFC').mockReturnValue(false);

    const messages: ChatMessage[] = [
      {
        content: 'I have a tool call.',
        createdAt: Date.now(),
        id: 'test-id-3',
        meta: {},
        role: 'assistant',
        tools: [
          {
            apiName: 'testApi',
            arguments: '{}',
            id: 'tool_123',
            identifier: 'test-plugin',
            type: 'default',
          },
        ],
        updatedAt: Date.now(),
      },
    ];

    const result = await contextEngineering({
      messages,
      model: 'some-model-without-fc',
      provider: 'openai',
    });

    // Index 0 is the injected Phở Chat default system message.
    expect(result[1].tool_calls).toBeUndefined();
    expect(result[1].content).toBe('I have a tool call.');
  });

  describe('Process placeholder variables', () => {
    it('should process placeholder variables in string content', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Hello {{username}}, today is {{date}} and the time is {{time}}',
          createdAt: Date.now(),
          id: 'test-placeholder-1',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
        {
          content: 'Hi there! Your random number is {{random}}',
          createdAt: Date.now(),
          id: 'test-placeholder-2',
          meta: {},
          role: 'assistant',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Index 0 is the injected Phở Chat default system message.
      expect(result[1].content).toBe(
        'Hello TestUser, today is 2023-12-25 and the time is 14:30:45',
      );
      expect(result[2].content).toBe('Hi there! Your random number is 12345');
    });

    it('should process placeholder variables in array content', async () => {
      const messages = [
        {
          content: [
            {
              text: 'Hello {{username}}, today is {{date}}',
              type: 'text',
            },
            {
              image_url: { url: 'data:image/png;base64,abc123' },
              type: 'image_url',
            },
          ],
          createdAt: Date.now(),
          id: 'test-placeholder-array',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ] as any;

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Index 0 is the injected Phở Chat default system message.
      expect(Array.isArray(result[1].content)).toBe(true);
      const content = result[1].content as any[];
      expect(content[0].text).toBe('Hello TestUser, today is 2023-12-25');
      expect(content[1].image_url.url).toBe('data:image/png;base64,abc123');
    });

    it('should handle missing placeholder variables gracefully', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Hello {{username}}, missing: {{missing_var}}',
          createdAt: Date.now(),
          id: 'test-placeholder-missing',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Index 0 is the injected Phở Chat default system message.
      expect(result[1].content).toBe('Hello TestUser, missing: {{missing_var}}');
    });

    it('should not modify messages without placeholder variables', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Hello there, no variables here',
          createdAt: Date.now(),
          id: 'test-no-placeholders',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Index 0 is the injected Phở Chat default system message.
      expect(result[1].content).toBe('Hello there, no variables here');
    });

    it('should process placeholder variables combined with other processors', async () => {
      isServerMode = true;
      vi.spyOn(helpers, 'isCanUseVision').mockReturnValue(true);

      const messages: ChatMessage[] = [
        {
          content: 'Hello {{username}}, check this image from {{date}}',
          createdAt: Date.now(),
          id: 'test-combined',
          imageList: [
            {
              alt: 'test image',
              id: 'img1',
              url: 'http://example.com/test.jpg',
            },
          ],
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4o',
        provider: 'openai',
      });

      // Index 0 is the injected Phở Chat default system message.
      expect(Array.isArray(result[1].content)).toBe(true);
      const content = result[1].content as any[];

      // Should contain processed placeholder variables in the text content
      expect(content[0].text).toContain('Hello TestUser, check this image from 2023-12-25');

      // Should also contain file context from MessageContentProcessor
      expect(content[0].text).toContain('SYSTEM CONTEXT');

      // Should contain image from vision processing
      expect(content[1].type).toBe('image_url');
      expect(content[1].image_url.url).toBe('http://example.com/test.jpg');

      isServerMode = false;
    });
  });

  describe('Message preprocessing processors', () => {
    it('should truncate message history when enabled', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Message 1',
          createdAt: Date.now(),
          id: 'test-1',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
        {
          content: 'Response 1',
          createdAt: Date.now(),
          id: 'test-2',
          meta: {},
          role: 'assistant',
          updatedAt: Date.now(),
        },
        {
          content: 'Message 2',
          createdAt: Date.now(),
          id: 'test-3',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
        {
          content: 'Response 2',
          createdAt: Date.now(),
          id: 'test-4',
          meta: {},
          role: 'assistant',
          updatedAt: Date.now(),
        },
        {
          content: 'Latest message',
          createdAt: Date.now(),
          id: 'test-5',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        enableHistoryCount: true,
        historyCount: 4,
        messages,
        model: 'gpt-4',
        provider: 'openai', // Should keep last 2 messages
      });

      // Should keep the last 4 messages, plus the injected Phở Chat system message
      expect(result).toHaveLength(5);
      expect(result).toEqual([
        phoSystemMessage,
        { content: 'Response 1', role: 'assistant' },
        { content: 'Message 2', role: 'user' },
        { content: 'Response 2', role: 'assistant' },
        { content: 'Latest message', role: 'user' },
      ]);
    });

    it('should apply input template to user messages', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Original user input',
          createdAt: Date.now(),
          id: 'test-template',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
        {
          content: 'Assistant response',
          createdAt: Date.now(),
          id: 'test-assistant',
          meta: {},
          role: 'assistant',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        inputTemplate: 'Template: {{text}} - End',
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Should apply template to user message only
      expect(result).toEqual([
        phoSystemMessage,
        {
          content: 'Template: Original user input - End',
          role: 'user',
        },
        {
          content: 'Assistant response',
          role: 'assistant',
        },
      ]);
      expect(result[2].content).toBe('Assistant response'); // Unchanged
    });

    it('should inject system role at the beginning', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'User message',
          createdAt: Date.now(),
          id: 'test-user',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'You are a helpful assistant.',
      });

      // Should have system role at the beginning
      expect(result).toEqual([
        { content: 'You are a helpful assistant.', role: 'system' },
        { content: 'User message', role: 'user' },
      ]);
    });

    it('should combine all preprocessing steps correctly', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Old message 1',
          createdAt: Date.now(),
          id: 'test-old-1',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
        {
          content: 'Old response',
          createdAt: Date.now(),
          id: 'test-old-2',
          meta: {},
          role: 'assistant',
          updatedAt: Date.now(),
        },
        {
          content: 'Recent input with {{username}}',
          createdAt: Date.now(),
          id: 'test-recent',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        enableHistoryCount: true,
        historyCount: 2,
        inputTemplate: 'Processed: {{text}}',
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'System instructions.', // Should keep last 1 message
      });

      // System role should be first
      expect(result).toEqual([
        {
          content: 'System instructions.',
          role: 'system',
        },
        {
          content: 'Old response',
          role: 'assistant',
        },
        {
          content: 'Processed: Recent input with TestUser',
          role: 'user',
        },
      ]);
    });

    it('should skip preprocessing when no configuration is provided', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Simple message',
          createdAt: Date.now(),
          id: 'test-simple',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Should pass message unchanged, with the injected Phở Chat system message
      expect(result).toEqual([
        phoSystemMessage,
        {
          content: 'Simple message',
          role: 'user',
        },
      ]);
    });

    it('should handle history truncation with system role injection correctly', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'Message 1',
          createdAt: Date.now(),
          id: 'test-1',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
        {
          content: 'Message 2',
          createdAt: Date.now(),
          id: 'test-2',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
        {
          content: 'Message 3',
          createdAt: Date.now(),
          id: 'test-3',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      const result = await contextEngineering({
        enableHistoryCount: true,
        historyCount: 1,
        messages,
        model: 'gpt-4',
        provider: 'openai',
        systemRole: 'System role here.', // Should keep only 1 message
      });

      // Should have system role + 1 truncated message
      expect(result).toEqual([
        {
          content: 'System role here.',
          role: 'system',
        },
        {
          content: 'Message 3', // Only the last message should remain
          role: 'user',
        },
      ]);
    });

    it('should handle input template compilation errors gracefully', async () => {
      const messages: ChatMessage[] = [
        {
          content: 'User message',
          createdAt: Date.now(),
          id: 'test-error',
          meta: {},
          role: 'user',
          updatedAt: Date.now(),
        },
      ];

      // This should not throw an error, but handle it gracefully
      const result = await contextEngineering({
        inputTemplate: '<%- invalid javascript syntax %>',
        messages,
        model: 'gpt-4',
        provider: 'openai',
      });

      // Should keep original message when template fails, with the injected
      // Phở Chat system message prepended.
      expect(result).toEqual([
        phoSystemMessage,
        {
          content: 'User message',
          role: 'user',
        },
      ]);
    });
  });
});
