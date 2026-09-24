import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamLLMResponse, transformSSEStream, createErrorStream, type LLMStreamConfig } from '../../src/services/llm-proxy';

// Helper to read the full text from a ReadableStream
async function readStreamAsText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }

  return result;
}

// Helper to parse SSE events from raw text
function parseSSEEvents(text: string): string[] {
  return text
    .split('\n\n')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

// Helper to create a mock SSE stream from OpenAI format chunks
function createMockSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

describe('LLM Proxy - createErrorStream', () => {
  it('should create a stream with a single error event', async () => {
    const stream = createErrorStream('Something went wrong');
    const text = await readStreamAsText(stream);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(1);
    expect(events[0]).toBe('data: {"error":"Something went wrong"}');
  });

  it('should handle special characters in error message', async () => {
    const stream = createErrorStream('Error: "timeout" at 30s');
    const text = await readStreamAsText(stream);
    const parsed = JSON.parse(text.replace('data: ', '').trim());

    expect(parsed.error).toBe('Error: "timeout" at 30s');
  });
});

describe('LLM Proxy - transformSSEStream', () => {
  it('should transform OpenAI SSE format to simplified format', async () => {
    const mockChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const source = createMockSSEStream(mockChunks);
    const controller = new AbortController();
    const transformed = transformSSEStream(source, controller, 30000);

    const text = await readStreamAsText(transformed);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(3);
    expect(events[0]).toBe('data: {"content":"Hello"}');
    expect(events[1]).toBe('data: {"content":" world"}');
    expect(events[2]).toBe('data: [DONE]');
  });

  it('should handle chunks split across multiple reads', async () => {
    // Simulate a chunk being split mid-line
    const mockChunks = [
      'data: {"choices":[{"delta":{"con',
      'tent":"split"}}]}\n\ndata: [DONE]\n\n',
    ];

    const source = createMockSSEStream(mockChunks);
    const controller = new AbortController();
    const transformed = transformSSEStream(source, controller, 30000);

    const text = await readStreamAsText(transformed);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(2);
    expect(events[0]).toBe('data: {"content":"split"}');
    expect(events[1]).toBe('data: [DONE]');
  });

  it('should skip SSE comments and empty lines', async () => {
    const mockChunks = [
      ': this is a comment\n\n',
      'data: {"choices":[{"delta":{"content":"text"}}]}\n\n',
      '\n',
      'data: [DONE]\n\n',
    ];

    const source = createMockSSEStream(mockChunks);
    const controller = new AbortController();
    const transformed = transformSSEStream(source, controller, 30000);

    const text = await readStreamAsText(transformed);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(2);
    expect(events[0]).toBe('data: {"content":"text"}');
    expect(events[1]).toBe('data: [DONE]');
  });

  it('should skip delta events with no content', async () => {
    const mockChunks = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"real content"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const source = createMockSSEStream(mockChunks);
    const controller = new AbortController();
    const transformed = transformSSEStream(source, controller, 30000);

    const text = await readStreamAsText(transformed);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(2);
    expect(events[0]).toBe('data: {"content":"real content"}');
    expect(events[1]).toBe('data: [DONE]');
  });

  it('should ignore malformed JSON in SSE data', async () => {
    const mockChunks = [
      'data: {not valid json}\n\n',
      'data: {"choices":[{"delta":{"content":"good"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const source = createMockSSEStream(mockChunks);
    const controller = new AbortController();
    const transformed = transformSSEStream(source, controller, 30000);

    const text = await readStreamAsText(transformed);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(2);
    expect(events[0]).toBe('data: {"content":"good"}');
    expect(events[1]).toBe('data: [DONE]');
  });

  it('should emit [DONE] when source stream ends without [DONE] marker', async () => {
    const mockChunks = [
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    ];

    const source = createMockSSEStream(mockChunks);
    const controller = new AbortController();
    const transformed = transformSSEStream(source, controller, 30000);

    const text = await readStreamAsText(transformed);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(2);
    expect(events[0]).toBe('data: {"content":"partial"}');
    expect(events[1]).toBe('data: [DONE]');
  });

  it('should emit error event when source stream throws', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
      },
      pull() {
        throw new Error('Network failure');
      },
    });

    const controller = new AbortController();
    const transformed = transformSSEStream(source, controller, 30000);

    const text = await readStreamAsText(transformed);
    const events = parseSSEEvents(text);

    // Should have the initial content and then the error
    expect(events.length).toBeGreaterThanOrEqual(1);
    const lastEvent = events[events.length - 1];
    expect(lastEvent).toContain('"error"');
  });
});

describe('LLM Proxy - streamLLMResponse', () => {
  const baseConfig: LLMStreamConfig = {
    baseUrl: 'https://api.example.com',
    apiKey: 'test-key-123',
    modelName: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call the correct endpoint with stream: true', async () => {
    const mockStream = createMockSSEStream(['data: [DONE]\n\n']);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockStream,
    });
    vi.stubGlobal('fetch', mockFetch);

    await streamLLMResponse(baseConfig);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer test-key-123');
    expect(options.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should include max_tokens when specified', async () => {
    const mockStream = createMockSSEStream(['data: [DONE]\n\n']);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockStream,
    });
    vi.stubGlobal('fetch', mockFetch);

    await streamLLMResponse({ ...baseConfig, maxTokens: 500 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(500);
  });

  it('should strip trailing slash from baseUrl', async () => {
    const mockStream = createMockSSEStream(['data: [DONE]\n\n']);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockStream,
    });
    vi.stubGlobal('fetch', mockFetch);

    await streamLLMResponse({ ...baseConfig, baseUrl: 'https://api.example.com/' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/chat/completions');
  });

  it('should return a transformed stream on success', async () => {
    const mockChunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const mockStream = createMockSSEStream(mockChunks);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockStream,
    });
    vi.stubGlobal('fetch', mockFetch);

    const stream = await streamLLMResponse(baseConfig);
    const text = await readStreamAsText(stream);
    const events = parseSSEEvents(text);

    expect(events).toContain('data: {"content":"Hi"}');
    expect(events).toContain('data: [DONE]');
  });

  it('should retry up to 3 times on connection failure', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce({
        ok: true,
        body: createMockSSEStream(['data: [DONE]\n\n']),
      });
    vi.stubGlobal('fetch', mockFetch);

    const stream = await streamLLMResponse(baseConfig);
    const text = await readStreamAsText(stream);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(text).toContain('[DONE]');
  });

  it('should return error stream when all retries are exhausted', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    const stream = await streamLLMResponse(baseConfig);
    const text = await readStreamAsText(stream);
    const events = parseSSEEvents(text);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"error"');
    expect(events[0]).toContain('Connection refused');
  });

  it('should return error stream on non-ok HTTP response after retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    const stream = await streamLLMResponse(baseConfig);
    const text = await readStreamAsText(stream);
    const events = parseSSEEvents(text);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"error"');
    expect(events[0]).toContain('Internal Server Error');
  });

  it('should return error stream when response has no body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
    });
    vi.stubGlobal('fetch', mockFetch);

    const stream = await streamLLMResponse(baseConfig);
    const text = await readStreamAsText(stream);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"error"');
    expect(events[0]).toContain('no response body');
  });

  it('should use custom timeout when specified', async () => {
    // Use a very short timeout to trigger AbortError
    const mockFetch = vi.fn().mockImplementation((_url: string, options: { signal: AbortSignal }) => {
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const stream = await streamLLMResponse({ ...baseConfig, timeoutMs: 50 });
    const text = await readStreamAsText(stream);
    const events = parseSSEEvents(text);

    expect(events).toHaveLength(1);
    expect(events[0]).toContain('"error"');
    expect(events[0]).toContain('timed out');
  });
});
