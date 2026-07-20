import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  FREE_TIER_RETENTION_DAYS,
  getRetentionCutoff,
  mergeOccurredAtGte,
  UserTier,
} from '../common/retention.util';
import { UserService } from '../UserModule/userService';
import { CreateEventDto, ListEventsQueryDto } from './eventDto';
import EventEntity, { EventDocument } from './eventEntity';

@Injectable()
export class EventService {
  constructor(
    @Inject('EVENT_REPOSITORY')
    private readonly eventRepository: typeof EventEntity,
    private readonly userService: UserService,
  ) {}

  async createEvent(
    userId: string,
    dto: CreateEventDto,
  ): Promise<EventDocument> {
    try {
      return await this.eventRepository.create({
        userId,
        source: dto.source,
        type: dto.type,
        title: dto.title,
        content: dto.content ?? '',
        summary: dto.summary ?? '',
        occurredAt: new Date(dto.occurredAt),
        projectId: dto.projectId ?? null,
        tags: dto.tags ?? [],
        sourceEventId: dto.sourceEventId ?? null,
        metadata: dto.metadata ?? {},
      });
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code: number }).code
          : undefined;
      if (code === 11000) {
        throw new ConflictException(
          'Event already exists (duplicate sourceEventId)',
        );
      }
      throw err;
    }
  }

  /** Insert or refresh title/content/metadata for the same sourceEventId. */
  async upsertBySourceEventId(
    userId: string,
    dto: CreateEventDto,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    if (!dto.sourceEventId) {
      await this.createEvent(userId, dto);
      return 'created';
    }

    const existing = await this.eventRepository
      .findOne({
        userId,
        source: dto.source,
        sourceEventId: dto.sourceEventId,
      })
      .exec();

    if (!existing) {
      await this.createEvent(userId, dto);
      return 'created';
    }

    const nextContent = dto.content ?? '';
    const isPlaceholder =
      !existing.content ||
      existing.content.startsWith('Pushed 0 commit') ||
      /^Pushed \d+ commit/.test(existing.content) ||
      existing.content.startsWith('Push to ');

    const titleChanged = existing.title !== dto.title;
    const contentImproved =
      isPlaceholder && nextContent.length > 0 && nextContent !== existing.content;

    if (!titleChanged && !contentImproved) {
      return 'unchanged';
    }

    if (titleChanged) existing.title = dto.title;
    if (contentImproved) existing.content = nextContent;
    if (dto.summary) existing.summary = dto.summary;
    if (dto.metadata) existing.metadata = dto.metadata;
    await existing.save();
    return 'updated';
  }

  async createEventsBatch(
    userId: string,
    dtos: CreateEventDto[],
  ): Promise<EventDocument[]> {
    const docs = dtos.map((dto) => ({
      userId,
      source: dto.source,
      type: dto.type,
      title: dto.title,
      content: dto.content ?? '',
      summary: dto.summary ?? '',
      occurredAt: new Date(dto.occurredAt),
      projectId: dto.projectId ?? null,
      tags: dto.tags ?? [],
      sourceEventId: dto.sourceEventId ?? null,
      metadata: dto.metadata ?? {},
    }));

    return this.eventRepository.insertMany(docs, { ordered: false });
  }

  async listEvents(
    userId: string,
    query: ListEventsQueryDto,
  ): Promise<EventDocument[]> {
    const tier = await this.userService.getUserTier(userId);
    const filter = this.buildFilter(userId, query, tier);

    return this.eventRepository
      .find(filter)
      .sort({ occurredAt: -1 })
      .limit(500)
      .exec();
  }

  async getEventsForRange(
    userId: string,
    from: Date,
    to: Date,
    tier?: UserTier,
  ): Promise<EventDocument[]> {
    const userTier = tier ?? (await this.userService.getUserTier(userId));
    const cutoff = getRetentionCutoff(userTier);
    const effectiveFrom = cutoff ? mergeOccurredAtGte(from, cutoff) : from;

    if (effectiveFrom.getTime() > to.getTime()) {
      return [];
    }

    return this.eventRepository
      .find({
        userId,
        occurredAt: { $gte: effectiveFrom, $lte: to },
      })
      .sort({ occurredAt: 1 })
      .exec();
  }

  async getRetentionMeta(userId: string) {
    const tier = await this.userService.getUserTier(userId);
    const cutoff = getRetentionCutoff(tier);
    return {
      tier,
      retentionDays: tier === 'free' ? FREE_TIER_RETENTION_DAYS : null,
      retentionCutoff: cutoff?.toISOString() ?? null,
    };
  }

  private buildFilter(
    userId: string,
    query: ListEventsQueryDto,
    tier: UserTier,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = { userId };
    const cutoff = getRetentionCutoff(tier);

    let occurredAt: Record<string, Date> = {};
    if (query.from) occurredAt.$gte = new Date(query.from);
    if (query.to) occurredAt.$lte = new Date(query.to);
    if (cutoff) {
      occurredAt.$gte = mergeOccurredAtGte(occurredAt.$gte, cutoff);
    }
    if (Object.keys(occurredAt).length > 0) {
      filter.occurredAt = occurredAt;
    }

    if (query.source) filter.source = query.source;
    if (query.projectId) filter.projectId = query.projectId;

    return filter;
  }
}
