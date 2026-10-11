'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; done?: boolean }[];
}

interface SiteConfig {
  name: string;
  welcome: string;
  suggestedQuestions: string[];
}

/* 回字纹：铺在面板底部作底纹，透明度由外层控制 */
function HuiPattern({ opacity = 0.5 }: { opacity?: number }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ opacity }}
      aria-hidden="true"
    >
      <defs>
        <pattern id="hui" width="28" height="28" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#7a6442" strokeWidth="1" strokeOpacity="0.2">
            <rect x="0" y="0" width="28" height="28" />
            <rect x="6" y="6" width="16" height="16" />
            <rect x="12" y="12" width="4" height="4" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hui)" />
    </svg>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  const html = marked.parse(content) as string;
  return <div className="prose-chat" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function ChatPanel({ mode = 'full' }: { mode?: 'full' | 'widget' }) {
  const [config, setConfig] = useState<SiteConfig>({ name: 'AI Chat Assistant', welcome: '', suggestedQuestions: [] });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isZh, setIsZh] = useState(false);

  useEffect(() => {
    setIsZh(navigator.language?.startsWith('zh') ?? false);
  }, []);
  const [conversationId] = useState(() => {
    if (typeof window === 'undefined') return '';
    const key = 'ai-chat-assistant-cid';
    let cid = localStorage.getItem(key);
    if (!cid) {
      cid = crypto.randomUUID();
      localStorage.setItem(key, cid);
    }
    return cid;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const composingRef = useRef(false);
  const pageContextRef = useRef<{ title?: string; url?: string; content?: string } | null>(null);

  // Load config
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => {
        setConfig({
          name: c.name || 'AI Chat Assistant',
          welcome: c.welcome || '',
          suggestedQuestions: c.suggestedQuestions || [],
        });
      })
      .catch(() => {});
  }, []);

  // Listen for page context from parent window
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === '__aa_page_context' && e.data.payload) {
        pageContextRef.current = e.data.payload;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isStreaming) return;
    setInput('');
    setIsStreaming(true);

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: msg };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'makers-conversation-id': conversationId,
        },
        body: JSON.stringify({
          message: msg,
          ...(pageContextRef.current ? { pageContext: pageContextRef.current } : {}),
        }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const event = JSON.parse(payload);
            if (event.type === 'text_delta' && event.delta) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + event.delta } : m,
                ),
              );
            } else if (event.type === 'tool_call' && event.tool) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, toolCalls: [...(m.toolCalls || []), { name: event.tool }] }
                    : m,
                ),
              );
            } else if (event.type === 'tool_result' && event.tool) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId || !m.toolCalls) return m;
                  const updated = m.toolCalls.map((tc) =>
                    tc.name === event.tool && !tc.done ? { ...tc, done: true } : tc,
                  );
                  return { ...m, toolCalls: updated };
                }),
              );
            } else if (event.type === 'error_message') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content || `⚠️ ${event.content}` }
                    : m,
                ),
              );
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || '⚠️ Failed to connect.' }
              : m,
          ),
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, conversationId]);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    fetch('/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId }),
    }).catch(() => {});
  }, [conversationId]);

  const clearChat = useCallback(() => {
    setMessages([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ai-chat-assistant-cid');
    }
  }, []);

  const isWidget = mode === 'widget';

  return (
    <div
      className={`relative flex flex-col overflow-hidden ${isWidget ? 'h-full' : 'h-screen'} paper-shell ${isWidget ? 'rounded-2xl' : ''}`}
    >
      {/* 纸底：大面留白处才透出的淡淡斑驳与回字纹 */}
      <div className="aged-paper pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden="true">
        <HuiPattern />
      </div>

      {/* Header —— 卷首题签 */}
      <header className="relative z-10 flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-3">
          {/* 落款小印 */}
          <span className="seal-mark flex h-8 w-8 items-center justify-center rounded-[3px] text-[13px] font-semibold">
            {isZh ? '狄' : 'AI'}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-serif text-[15px] font-semibold tracking-wide text-ink">
              {isZh ? '狄仁杰' : config.name}
            </span>
            <span className="text-[10px] tracking-[0.2em] text-ink-faint">
              {isZh ? '同凤阁鸾台平章事' : 'AI ASSISTANT'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded-md p-1.5 text-ink-faint transition hover:bg-[rgba(122,100,66,0.08)] hover:text-ink-soft"
              title={isZh ? '清空' : 'Clear'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M0.667 13.982H13.334V4.316H9V0.496H5V4.316H0.667V13.982ZM2 12.649V8.982H12V12.649H5V10.316H3.667V12.649H2ZM12 7.649H2V5.649H6.333V1.829H7.667V5.649H12V7.649Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" fillOpacity="0.7"/></svg>
            </button>
          )}
        </div>
      </header>
      {/* 分栏线：中间一点小菱形 */}
      <div className="relative z-10 px-5">
        <div className="rule-ornament h-[5px]"><i /></div>
      </div>

      {/* Messages —— 正文经卷 */}
      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="relative mb-5">
              {/* 画像外的淡描边，像装裱的画心 */}
              <div className="absolute -inset-2 rounded-full border border-[rgba(176,141,79,0.35)]" aria-hidden="true" />
              <div className="absolute -inset-4 rounded-full border border-[rgba(176,141,79,0.18)]" aria-hidden="true" />
              <img
                src="https://r2.airmole.cn/i/2026/10/11/mfp405-wxcv.jpg"
                alt=""
                className="relative h-[104px] w-[104px] rounded-full object-cover shadow-paper"
              />
            </div>
            <h3 className="mb-2 font-serif text-lg font-semibold tracking-wide text-ink">
              {isZh ? '你好，我是' : 'Hey, This is '}
              <span className="text-cinnabar">{isZh ? ' AI 狄仁杰' : config.name}</span>
            </h3>
            <p className="mb-5 max-w-[320px] font-serif text-xs leading-[1.9] text-ink-faint">
              {isZh
                ? '在下姓狄，名仁杰，并州人士，官同凤阁鸾台平章事、加黜置使、兼幽州大都督，奉旨钦差提调幽州一切军政要务！'
                : 'Embeddable AI assistant for any website. One line of code to add a chat widget that understands page content and queries your backend APIs.'}
            </p>

            {config.suggestedQuestions.length > 0 && (
              <div className="mt-1 w-full space-y-2">
                {config.suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(q)}
                    className="group flex w-full items-center justify-between rounded-md border border-[var(--line-soft)] bg-[rgba(255,253,247,0.6)] px-4 py-3 text-left transition hover:border-[rgba(156,43,33,0.35)] hover:bg-[rgba(156,43,33,0.045)]"
                  >
                    <span className="line-clamp-1 font-serif text-sm text-ink-soft transition group-hover:text-cinnabar">{q}</span>
                    <svg className="ml-2 h-4 w-4 flex-shrink-0 text-ink-faint transition group-hover:text-cinnabar" viewBox="0 0 24 24" fill="none"><path d="M14.53 12L8.32 6.23l1.36-1.47 7 6.5.79.74-.79.73-7 6.5-1.36-1.47L14.53 12z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"/></svg>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="seal-mark mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[3px] font-serif text-[11px] font-semibold">
                  狄
                </div>
              )}
              <div
                className={`max-w-[82%] rounded-md px-3.5 py-2.5 ${
                  msg.role === 'user'
                    ? 'rounded-tr-sm bg-[var(--cinnabar)] text-[#fdf8ee]'
                    : 'rounded-tl-sm border border-[var(--line-soft)] bg-[rgba(255,253,247,0.82)]'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="font-serif text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                ) : msg.content ? (
                  <div className="relative">
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mb-2 space-y-1">
                        {msg.toolCalls.map((tc, i) => (
                          <div key={`${tc.name}-${i}`} className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] ${tc.done ? 'border-[rgba(122,100,66,0.25)] bg-[rgba(122,100,66,0.08)] text-ink-soft' : 'border-[rgba(156,43,33,0.25)] bg-[rgba(156,43,33,0.06)] text-cinnabar'}`}>
                            {tc.done ? (
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/></svg>
                            ) : (
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none"><path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z" fill="currentColor"/></svg>
                            )}
                            {tc.done ? (isZh ? `已查询 ${tc.name}` : `Queried ${tc.name}`) : (isZh ? `正在查询 ${tc.name}` : `Querying ${tc.name}`)}
                          </div>
                        ))}
                      </div>
                    )}
                    <MarkdownBlock content={msg.content} />
                    {isStreaming && msg.id === messages[messages.length - 1]?.id && (
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-cinnabar align-middle opacity-60" />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-1 text-xs text-ink-faint">
                    {msg.toolCalls && msg.toolCalls.length > 0 ? (
                      <div className="space-y-1">
                        {msg.toolCalls.map((tc, i) => (
                          <div key={`${tc.name}-${i}`} className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] ${tc.done ? 'border-[rgba(122,100,66,0.25)] bg-[rgba(122,100,66,0.08)] text-ink-soft' : 'border-[rgba(156,43,33,0.25)] bg-[rgba(156,43,33,0.06)] text-cinnabar'}`}>
                            {tc.done ? (
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/></svg>
                            ) : (
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none"><path d="M12 2a10 10 0 0 1 10 10h-2a8 8 0 0 0-8-8V2z" fill="currentColor"/></svg>
                            )}
                            {tc.done ? (isZh ? `已查询 ${tc.name}` : `Queried ${tc.name}`) : (isZh ? `正在查询 ${tc.name}` : `Querying ${tc.name}`)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Input —— 卷尾题写处 */}
      <div className="relative z-10 px-5 pt-0">
        <div className="rule-ornament h-[5px]"><i /></div>
      </div>
      <div className="relative z-10 bg-[rgba(236,226,205,0.5)] px-5 py-3.5">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={isZh ? '有事相询，但说无妨…' : 'Got questions? Feel free to ask.'}
            rows={1}
            className="min-h-[40px] max-h-[120px] flex-1 resize-none rounded-md border border-[var(--line)] bg-[rgba(255,253,247,0.9)] px-4 py-2.5 font-serif text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-[rgba(156,43,33,0.5)] focus:ring-2 focus:ring-[rgba(156,43,33,0.1)]"
          />
          {isStreaming ? (
            <button onClick={stopStream} className="flex-shrink-0 rounded-md border border-[rgba(156,43,33,0.35)] bg-[rgba(156,43,33,0.08)] p-2 text-cinnabar transition hover:bg-[rgba(156,43,33,0.14)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
            </button>
          ) : (
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim()}
              className="flex-shrink-0 rounded-md bg-[var(--cinnabar)] p-2 text-[#fdf8ee] transition hover:bg-[var(--cinnabar-light)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M0.99 7.67c-.48-.16-.49-.42.01-.59L18.71 1.17c.49-.16.77.08.63.57L14.28 19.5c-.14.49-.42.5-.63.04L10.32 12.02l5.57-7.43-7.42 5.57L0.99 7.67z" fill="currentColor"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
