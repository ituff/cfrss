/**
 * LLM Streaming Proxy - SSE streaming support for OpenAI-compatible LLM APIs.
 *
 * Handles:
 * - Calling the LLM API with stream: true
 * - 30-second timeout with AbortController
 * - Retry logic (max 3 attempts) for initial connection failures
 * - Transforming OpenAI SSE format to simplified frontend SSE format
 */

// --- Types ---

export interface LLMStreamConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  timeoutMs?: number; // default 30000
}

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

// --- Core streaming function ---

/**
 * Calls the LLM API and returns a ReadableStream of SSE events.
 * Implements timeout (default 30s) and retry logic (max 3 attempts).
 * The returned stream uses a simplified SSE format for the frontend.
 */
export async function streamLLMResponse(config: LLMStreamConfig): Promise<ReadableStream> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.modelName,
          messages: config.messages,
          stream: true,
          ...(config.maxTokens !== undefined && { max_tokens: config.maxTokens }),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const statusText = response.statusText || `HTTP ${response.status}`;
        throw new Error(`LLM API error: ${statusText}`);
      }

      if (!response.body) {
        throw new Error('LLM API returned no response body');
      }

      // Successfully connected — return the transformed stream
      return transformSSEStream(response.body, controller, timeoutMs);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        // Timeout on initial connection — retry
        lastError = new Error('LLM request timed out');
      } else {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      // Only retry on connection failures, not on successful-but-errored responses
      if (attempt < MAX_RETRIES) {
        continue;
      }
    }
  }

  // All retries exhausted — return an error stream
  return createErrorStream(lastError?.message ?? 'LLM connection failed after retries');
}

// --- SSE Stream Transformer ---

/**
 * Transforms the raw OpenAI SSE stream into a simplified format for the frontend.
 *
 * Input format (OpenAI): `data: {"choices":[{"delta":{"content":"..."}}]}`
 * Output format: `data: {"content":"..."}` or `data: {"error":"..."}` or `data: [DONE]`
 *
 * Also applies a timeout to the ongoing stream — if no data arrives for timeoutMs,
 * the stream is aborted and an error event is emitted.
 */
export function transformSSEStream(
  sourceStream: ReadableStream<Uint8Array>,
  abortController: AbortController,
  timeoutMs: number
): ReadableStream {
  const decoder = new TextDecoder();
  let buffer = '';
  let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const resetStreamTimeout = (controller: ReadableStreamDefaultController) => {
    if (streamTimeoutId !== null) {
      clearTimeout(streamTimeoutId);
    }
    streamTimeoutId = setTimeout(() => {
      abortController.abort();
      const errorEvent = `data: ${JSON.stringify({ error: 'LLM response timed out' })}\n\n`;
      controller.enqueue(new TextEncoder().encode(errorEvent));
      controller.close();
    }, timeoutMs);
  };

  const reader = sourceStream.getReader();

  return new ReadableStream({
    async start(controller) {
      resetStreamTimeout(controller);

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            if (streamTimeoutId !== null) {
              clearTimeout(streamTimeoutId);
            }
            // Send [DONE] event
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }

          resetStreamTimeout(controller);

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) {
              // Empty line or SSE comment — skip
              continue;
            }

            if (trimmed === 'data: [DONE]') {
              if (streamTimeoutId !== null) {
                clearTimeout(streamTimeoutId);
              }
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              controller.close();
              return;
            }

            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const parsed = JSON.parse(jsonStr);
                const content = parsed?.choices?.[0]?.delta?.content;
                if (content !== undefined && content !== null) {
                  const simplified = `data: ${JSON.stringify({ content })}\n\n`;
                  controller.enqueue(new TextEncoder().encode(simplified));
                }
              } catch {
                // Ignore malformed JSON lines
              }
            }
          }
        }
      } catch (error) {
        if (streamTimeoutId !== null) {
          clearTimeout(streamTimeoutId);
        }
        const message = error instanceof Error ? error.message : 'Stream read error';
        const errorEvent = `data: ${JSON.stringify({ error: message })}\n\n`;
        controller.enqueue(new TextEncoder().encode(errorEvent));
        controller.close();
      }
    },

    cancel() {
      if (streamTimeoutId !== null) {
        clearTimeout(streamTimeoutId);
      }
      abortController.abort();
      reader.cancel();
    },
  });
}

// --- Error Stream Helper ---

/**
 * Creates a ReadableStream that emits a single error SSE event and closes.
 */
export function createErrorStream(message: string): ReadableStream {
  const encoder = new TextEncoder();
  const errorEvent = `data: ${JSON.stringify({ error: message })}\n\n`;

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(errorEvent));
      controller.close();
    },
  });
}
