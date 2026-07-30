import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { localDayBoundsUtc } from '../common/timezone.util';
import { EventDocument } from '../EventModule/eventEntity';
import { EventService } from '../EventModule/eventService';
import { AiAskDto, AiDaySummaryDto, AiSearchDto } from './aiDto';
import { LlmClient } from './llm.client';

export type RankedMoment = {
  id: string;
  score: number;
  source: string;
  type: string;
  title: string;
  content: string;
  summary: string;
  occurredAt: string;
  projectId: string | null;
  sourceEventId: string | null;
  metadata: Record<string, unknown>;
};

@Injectable()
export class AiService {
  constructor(
    private readonly eventService: EventService,
    private readonly llm: LlmClient,
  ) {}

  async search(userId: string, dto: AiSearchDto) {
    const limit = dto.limit ?? 15;
    const range = this.resolveRange({
      from: dto.from,
      to: dto.to,
      timezone: 'UTC',
      defaultDays: 30,
    });

    const candidates = await this.gatherCandidates(
      userId,
      dto.query,
      range,
      dto.source,
      dto.projectId,
    );
    const moments = this.rankMoments(candidates, dto.query, limit);
    const retention = await this.eventService.getRetentionMeta(userId);

    return {
      query: dto.query,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      totalCandidates: candidates.length,
      moments,
      ...retention,
    };
  }

  async ask(userId: string, dto: AiAskDto) {
    const timezone = dto.timezone || 'Asia/Kolkata';
    const retention = await this.eventService.getRetentionMeta(userId);

    // Conversational chitchat — reply like a helpful human, skip memory search
    const chitchat = this.chitchatReply(dto.question);
    if (chitchat) {
      const now = new Date();
      return {
        question: dto.question,
        answer: chitchat,
        provider: 'local' as const,
        from: now.toISOString(),
        to: now.toISOString(),
        moments: [],
        ...retention,
      };
    }

    const range = this.resolveRange({
      date: dto.date,
      from: dto.from,
      to: dto.to,
      timezone,
      question: dto.question,
      defaultDays: 30,
    });

    const candidates = await this.gatherCandidates(
      userId,
      dto.question,
      range,
      dto.source,
      dto.projectId,
    );
    let moments = this.rankMoments(candidates, dto.question, 25);

    // For "why" questions: keep explanatory notes first, drop browse-URL noise
    if (this.isWhyQuestion(dto.question)) {
      moments = this.prioritizeExplanatoryMoments(moments);
    }

    if (moments.length === 0) {
      return {
        question: dto.question,
        answer:
          "I looked through your timeline, but I couldn't find anything on that yet. " +
          'Try syncing an app, capturing a quick note, or asking about something you did recently — I\'m here to help.',
        provider: 'local' as const,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        moments: [],
        ...retention,
      };
    }

    // Deterministic answer when a note already states the reason — still human-toned
    const directNote = moments.find(
      (m) =>
        (m.source === 'manual' || m.type === 'note') &&
        this.hasExplanationText(`${m.title}\n${m.summary}\n${m.content}`),
    );
    if (this.isWhyQuestion(dto.question) && directNote) {
      const ordered = this.putFirst(moments, directNote.id);
      return {
        question: dto.question,
        answer: this.humanizeNoteAnswer(dto.question, directNote, timezone),
        provider: 'local' as const,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        moments: ordered,
        ...retention,
      };
    }

    if (this.llm.isConfigured()) {
      try {
        const direct = moments.filter(
          (m) =>
            m.source === 'manual' ||
            m.type === 'note' ||
            this.hasExplanationText(`${m.title}\n${m.summary}\n${m.content}`),
        );
        const directBlock =
          direct.length > 0
            ? `DIRECT ANSWER CANDIDATES (use these first if they answer the question):\n` +
              this.formatMomentsForPrompt(direct.slice(0, 5)) +
              `\n\n`
            : '';

        const answer = await this.llm.chat([
          {
            role: 'system',
            content:
              'You are AI Time Machine — a warm, helpful personal memory companion (like a thoughtful friend who remembers the user\'s digital life).\n' +
              'TONE:\n' +
              '- Talk like a human: natural, friendly, clear. Use “you / your”.\n' +
              '- Do NOT sound like a database dump or robot (“From your manual note [#1]: …”).\n' +
              '- Lead with the answer in plain language, then lightly mention where it came from.\n' +
              '- Keep it short (2–4 sentences). Offer a gentle follow-up if useful.\n' +
              'FACTS:\n' +
              '1) Answer ONLY from the provided moments. Prefer manual notes when they answer the question.\n' +
              '2) If a moment states a reason, explain it naturally and cite [#n].\n' +
              '3) NEVER invent encyclopedia facts. NEVER say “not explicitly stated” when a moment already answers.\n' +
              '4) Ignore Chrome/GitHub visits that only show a repo name — that is not a reason.\n' +
              '5) If the user is just chatting (hi/thanks), reply warmly and ask how you can help — no fake memories.',
          },
          {
            role: 'user',
            content:
              `Question: ${dto.question}\n` +
              `Timezone: ${timezone}\n` +
              `Range: ${range.from.toISOString()} → ${range.to.toISOString()}\n\n` +
              directBlock +
              `All moments (highest relevance first):\n${this.formatMomentsForPrompt(moments)}`,
          },
        ]);

        return {
          question: dto.question,
          answer,
          provider: this.llm.providerLabel(),
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          moments,
          ...retention,
        };
      } catch {
        return {
          question: dto.question,
          answer:
            this.buildLocalAnswer(dto.question, moments, timezone) +
            '\n\n(I hit a snag reaching the AI provider — here\'s what I found in your timeline instead.)',
          provider: 'local' as const,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          moments,
          ...retention,
        };
      }
    }

    return {
      question: dto.question,
      answer: this.buildLocalAnswer(dto.question, moments, timezone),
      provider: 'local' as const,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      moments,
      ...retention,
    };
  }

  async daySummary(userId: string, dto: AiDaySummaryDto) {
    const timezone = dto.timezone || 'Asia/Kolkata';
    return this.ask(userId, {
      question: `What was I doing on ${dto.date}? Summarize my day as a Time Machine replay.`,
      date: dto.date,
      timezone,
      projectId: dto.projectId,
    });
  }

  /** Recent window + keyword matches + all manual notes (deduped). */
  private async gatherCandidates(
    userId: string,
    query: string,
    range: { from: Date; to: Date },
    source?: string,
    projectId?: string,
  ): Promise<EventDocument[]> {
    const tokens = this.tokenize(query);
    const [recent, matches, manuals] = await Promise.all([
      this.eventService.findCandidates(userId, {
        from: range.from,
        to: range.to,
        source,
        projectId,
        limit: 300,
      }),
      this.eventService.findTextMatches(userId, tokens, {
        source,
        projectId,
        limit: 100,
      }),
      // Always include notes — they hold explicit "why" answers
      !source || source === 'manual'
        ? this.eventService.findManualNotes(userId, { limit: 100 })
        : Promise.resolve([]),
    ]);

    const byId = new Map<string, EventDocument>();
    for (const e of [...manuals, ...matches, ...recent]) {
      byId.set(String(e._id), e);
    }
    return [...byId.values()];
  }

  private resolveRange(opts: {
    date?: string;
    from?: string;
    to?: string;
    timezone: string;
    question?: string;
    defaultDays: number;
  }): { from: Date; to: Date } {
    if (opts.date) {
      return localDayBoundsUtc(opts.date, opts.timezone);
    }
    if (opts.from || opts.to) {
      const from = opts.from
        ? new Date(opts.from)
        : DateTime.utc().minus({ days: opts.defaultDays }).toJSDate();
      const to = opts.to ? new Date(opts.to) : new Date();
      return { from, to };
    }

    const hint = this.inferRangeFromQuestion(opts.question, opts.timezone);
    if (hint) return hint;

    const to = new Date();
    const from = DateTime.utc()
      .minus({ days: opts.defaultDays })
      .startOf('day')
      .toJSDate();
    return { from, to };
  }

  private inferRangeFromQuestion(
    question: string | undefined,
    timezone: string,
  ): { from: Date; to: Date } | null {
    if (!question) return null;
    const q = question.toLowerCase();
    const now = DateTime.now().setZone(timezone);

    if (/\btoday\b/.test(q)) {
      return localDayBoundsUtc(now.toISODate()!, timezone);
    }
    if (/\byesterday\b/.test(q)) {
      const y = now.minus({ days: 1 });
      return localDayBoundsUtc(y.toISODate()!, timezone);
    }
    if (/\blast week\b/.test(q)) {
      const start = now.minus({ weeks: 1 }).startOf('week');
      const end = start.endOf('week');
      return { from: start.toUTC().toJSDate(), to: end.toUTC().toJSDate() };
    }
    if (/\bthis week\b/.test(q)) {
      const start = now.startOf('week');
      return { from: start.toUTC().toJSDate(), to: now.toUTC().toJSDate() };
    }
    return null;
  }

  private rankMoments(
    events: EventDocument[],
    query: string,
    limit: number,
  ): RankedMoment[] {
    const { topic, intent } = this.splitTokens(query);
    const qLower = query.toLowerCase();
    const isWhy =
      /\bwhy\b/.test(qLower) ||
      /\breason\b/.test(qLower) ||
      /\bbecause\b/.test(qLower);

    const scored = events.map((e) => {
      const title = (e.title ?? '').toLowerCase();
      const content = (e.content ?? '').toLowerCase();
      const summary = (e.summary ?? '').toLowerCase();
      const project = (e.projectId ?? '').toLowerCase();
      const body = `${title}\n${summary}\n${content}`;
      const titleN = this.normalizeText(title);
      const summaryN = this.normalizeText(summary);
      const contentN = this.normalizeText(content);
      const projectN = this.normalizeText(project);
      const hay = this.normalizeText(
        [title, content, summary, project, e.source, e.type, ...(e.tags ?? [])].join(
          ' ',
        ),
      );

      let topicHits = 0;
      let score = 0;

      for (const raw of topic) {
        const t = this.normalizeText(raw);
        if (!t) continue;
        let hit = false;
        if (titleN.includes(t)) {
          score += 10;
          hit = true;
        }
        if (summaryN.includes(t)) {
          score += 14;
          hit = true;
        }
        if (contentN.includes(t)) {
          score += 8;
          hit = true;
        }
        if (projectN.includes(t)) {
          score += 2; // weak: "Frontend-React" in repo name
        }
        if (hay.includes(t)) {
          score += 1;
          hit = true;
        }
        if (hit) topicHits += 1;
      }

      // Intent words like "why" only count when the TOPIC also matches.
      // Otherwise Chrome "why runnable in java" floods results.
      if (topicHits > 0) {
        for (const raw of intent) {
          const t = this.normalizeText(raw);
          if (!t) continue;
          if (titleN.includes(t) || summaryN.includes(t) || contentN.includes(t)) {
            score += 4;
          }
        }
        if (isWhy && /\b(because|reason|instead|client|want)\b/.test(body)) {
          score += 18;
        }
      } else if (topic.length > 0) {
        // No topic overlap → hard demote (keep tiny score only for empty topic queries)
        score = Math.min(score, 1);
      }

      if ((e.source === 'manual' || e.type === 'note') && topicHits > 0) {
        score += isWhy ? 25 : 8;
      }

      const explanatory = this.hasExplanationText(body);

      // "Why" questions: URL visits with "Frontend-React" are NOT a reason
      if (isWhy && topicHits > 0 && !explanatory) {
        if (e.source === 'chrome' || e.type === 'browse') {
          score = Math.min(score, 4);
        } else if (e.source !== 'manual' && e.type !== 'note') {
          score = Math.min(score, 8);
        }
      }

      if (isWhy && explanatory && topicHits > 0) {
        score += 20;
      }

      // Demote generic browse noise
      if (
        e.source === 'chrome' &&
        e.type === 'browse' &&
        (/google search/i.test(title) || /youtube/i.test(title))
      ) {
        score *= topicHits > 0 ? 0.5 : 0.15;
      }

      const ageDays =
        (Date.now() - new Date(e.occurredAt).getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 1.5 - ageDays / 14);

      if (topic.length === 0 && intent.length === 0) score = 1;

      return { event: e, score, topicHits };
    });

    const hasTopicSignal = scored.some((s) => s.topicHits > 0 && s.score >= 8);
    const list = hasTopicSignal
      ? scored.filter((s) => s.topicHits > 0 && s.score >= 5)
      : scored.filter((s) => s.score >= 1);

    return list
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (
          new Date(b.event.occurredAt).getTime() -
          new Date(a.event.occurredAt).getTime()
        );
      })
      .slice(0, limit)
      .map(({ event, score }) => this.toMoment(event, score));
  }

  /** Normalize react.js / reactjs → react for matching. */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/react\.?js/g, 'react')
      .replace(/node\.?js/g, 'node')
      .replace(/[^\p{L}\p{N}\s/_-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private splitTokens(text: string): { topic: string[]; intent: string[] } {
    const intentSet = new Set([
      'why',
      'how',
      'what',
      'when',
      'where',
      'reason',
      'because',
    ]);
    const stop = new Set([
      'was',
      'were',
      'doing',
      'did',
      'the',
      'and',
      'for',
      'with',
      'from',
      'about',
      'this',
      'that',
      'have',
      'been',
      'last',
      'week',
      'today',
      'yesterday',
      'my',
      'are',
      'you',
      'our',
      'we',
      'using',
      'use',
      'used',
      'js', // covered via react.js → react normalize
    ]);

    const normalized = this.normalizeText(text);
    const parts = normalized.split(/\s+/).filter((t) => t.length > 1 && !stop.has(t));

    const topic: string[] = [];
    const intent: string[] = [];
    for (const p of parts) {
      if (intentSet.has(p)) intent.push(p);
      else if (p.length > 2) topic.push(p);
    }

    // Ensure "react" present when user wrote "react js"
    if (/\breact\b/i.test(text) && !topic.includes('react')) {
      topic.push('react');
    }

    return {
      topic: [...new Set(topic)],
      intent: [...new Set(intent)],
    };
  }

  private isWhyQuestion(question: string): boolean {
    const q = question.toLowerCase();
    return (
      /\bwhy\b/.test(q) ||
      /\breason\b/.test(q) ||
      /\bresion\b/.test(q) || // common typo
      /\bbecause\b/.test(q)
    );
  }

  /** Greetings / thanks / small talk — no timeline search. */
  private chitchatReply(question: string): string | null {
    const q = question.trim().toLowerCase().replace(/[!?.]+$/g, '');
    if (!q || q.length > 80) return null;

    if (
      /^(hi|hello|hey|hii+|helo|yo|sup|hiya|good morning|good afternoon|good evening|namaste|hola)\b/.test(
        q,
      ) ||
      q === 'hi' ||
      q === 'hello' ||
      q === 'hey'
    ) {
      return "Hey! How can I help you today? You can ask things like “what was I doing yesterday?” or “why are we using React?”";
    }

    if (/^(thanks|thank you|thx|ty|thanku)\b/.test(q)) {
      return "You're welcome! Anytime — want me to dig into another day or project?";
    }

    if (/^(how are you|how's it going|whats up|what's up)\b/.test(q)) {
      return "I'm doing great, thanks for asking! Ready when you are — what would you like to replay or remember?";
    }

    if (/^(help|what can you do|who are you)\b/.test(q)) {
      return (
        "I'm your Time Machine — I help you replay your digital life. " +
        'Ask what you were doing on a day, why you made a decision, or what happened on a project. How can I help you today?'
      );
    }

    if (/^(ok|okay|cool|nice|great|awesome|got it)\b/.test(q)) {
      return 'Glad that helped! Anything else you want to look up?';
    }

    if (/^(bye|goodbye|see you|later)\b/.test(q)) {
      return 'See you later! I\'ll be here whenever you want to replay a moment.';
    }

    return null;
  }

  private humanizeNoteAnswer(
    question: string,
    note: RankedMoment,
    timezone: string,
  ): string {
    const when = DateTime.fromISO(note.occurredAt)
      .setZone(timezone)
      .toFormat('ccc HH:mm');
    const summary = (note.summary || '').trim();
    const title = (note.title || '').trim();
    const content = (note.content || '').trim();

    // Prefer the clearest human sentence
    const body =
      summary ||
      content ||
      title ||
      'you wrote a note about this';

    if (this.isWhyQuestion(question)) {
      return (
        `Here's what you wrote about that: ${body}` +
        (title && summary && title !== summary ? ` (${title})` : '') +
        `\n\nYou saved that around ${when}. Want me to pull related commits or browsing from the same day?`
      );
    }

    return (
      `I found this in your notes: ${body}\n\n` +
      `Saved around ${when}. Want me to look for more around that time?`
    );
  }

  private hasExplanationText(text: string): boolean {
    return /\b(because|reason|instead|client|want|chose|choose|prefer|responsive|fast)\b/i.test(
      text,
    );
  }

  /** Keep notes/explanations first; allow a few weak context moments after. */
  private prioritizeExplanatoryMoments(moments: RankedMoment[]): RankedMoment[] {
    const strong = moments.filter(
      (m) =>
        m.source === 'manual' ||
        m.type === 'note' ||
        this.hasExplanationText(`${m.title}\n${m.summary}\n${m.content}`),
    );
    const weak = moments.filter((m) => !strong.includes(m));
    if (strong.length === 0) return moments.slice(0, 12);
    return [...strong, ...weak.slice(0, 5)].slice(0, 20);
  }

  private putFirst(moments: RankedMoment[], id: string): RankedMoment[] {
    const hit = moments.find((m) => m.id === id);
    if (!hit) return moments;
    return [hit, ...moments.filter((m) => m.id !== id)];
  }

  private tokenize(text: string): string[] {
    const { topic, intent } = this.splitTokens(text);
    // Keyword DB search: topic first, then intent (intent alone is weak)
    return [...topic, ...intent];
  }

  private toMoment(event: EventDocument, score: number): RankedMoment {
    const summary = event.summary ?? '';
    const content = event.content ?? '';
    // Prefer the richest body for the LLM
    const body =
      [summary, content].filter((s) => s.trim().length > 0).join('\n') || content;

    return {
      id: String(event._id),
      score: Math.round(score * 100) / 100,
      source: event.source,
      type: event.type,
      title: event.title,
      content: body.slice(0, 800),
      summary: summary.slice(0, 400),
      occurredAt: new Date(event.occurredAt).toISOString(),
      projectId: event.projectId ?? null,
      sourceEventId: event.sourceEventId ?? null,
      metadata: (event.metadata as Record<string, unknown>) ?? {},
    };
  }

  private formatMomentsForPrompt(moments: RankedMoment[]): string {
    return moments
      .map((m, i) => {
        const when = m.occurredAt;
        const project = m.projectId ? ` project=${m.projectId}` : '';
        const summaryLine = m.summary ? `\nSummary: ${m.summary.slice(0, 400)}` : '';
        const contentLine = m.content
          ? `\nContent: ${m.content.slice(0, 400)}`
          : '';
        return (
          `[#${i + 1}] ${when} | ${m.source}/${m.type}${project} (score=${m.score})\n` +
          `Title: ${m.title}${summaryLine}${contentLine}`
        );
      })
      .join('\n\n');
  }

  private buildLocalAnswer(
    question: string,
    moments: RankedMoment[],
    timezone: string,
  ): string {
    const top = moments.slice(0, 8);
    const lines = top.map((m, i) => {
      const local = DateTime.fromISO(m.occurredAt)
        .setZone(timezone)
        .toFormat('ccc HH:mm');
      const project = m.projectId ? ` (${m.projectId})` : '';
      const detail = m.summary || m.content;
      const detailLine = detail
        ? `\n   ${detail.replace(/\s+/g, ' ').slice(0, 160)}`
        : '';
      return `${i + 1}. ${local} — [${m.source}] ${m.title}${project}${detailLine}`;
    });

    const best = top[0];
    const lead =
      best && (best.source === 'manual' || best.summary || best.content)
        ? `Looking at your timeline, this stands out: ${best.title}` +
          (best.summary || best.content
            ? ` — ${(best.summary || best.content).replace(/\s+/g, ' ').slice(0, 200)}`
            : '') +
          '\n\n'
        : '';

    return (
      `${lead}For “${question}”, here are the closest moments I found:\n` +
      lines.join('\n') +
      `\n\nWant me to narrow this to a day or a project?`
    );
  }
}
