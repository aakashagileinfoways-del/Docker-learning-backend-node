import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { CreateEventDto, EVENT_SOURCES } from '../EventModule/eventDto';
import { EventService } from '../EventModule/eventService';
import { GitHubService } from '../GitHubModule/githubService';
import {
  CONNECTOR_CATALOG,
  getCatalogItem,
} from './connectorCatalog';
import ConnectorConnectionEntity, {
  ConnectorConnectionDocument,
} from './connectorConnectionEntity';
import {
  ConnectConnectorDto,
  IngestEventsDto,
  ManualNoteDto,
} from './connectorsDto';

type EventSource = (typeof EVENT_SOURCES)[number];
type StoredCredentials = {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
};

@Injectable()
export class ConnectorsService {
  constructor(
    @Inject('CONNECTOR_CONNECTION_REPOSITORY')
    private readonly connectionRepository: typeof ConnectorConnectionEntity,
    private readonly encryptionService: EncryptionService,
    private readonly eventService: EventService,
    private readonly githubService: GitHubService,
  ) {}

  listCatalog() {
    return CONNECTOR_CATALOG;
  }

  async listStatuses(userId: string) {
    const connections = await this.connectionRepository
      .find({ userId })
      .exec();
    const bySource = new Map(connections.map((c) => [c.source, c]));

    const github = await this.githubService.getStatus(userId);

    return CONNECTOR_CATALOG.map((item) => {
      if (item.source === 'github') {
        return {
          ...item,
          connected: github.connected,
          accountLabel: github.connected ? `@${github.username}` : '',
          lastSyncedAt: github.lastSyncedAt ?? null,
        };
      }

      if (item.source === 'manual') {
        return {
          ...item,
          connected: true,
          accountLabel: 'Always on',
          lastSyncedAt: null,
        };
      }

      const conn = bySource.get(item.source);
      return {
        ...item,
        connected: !!conn?.enabled,
        accountLabel: conn?.accountLabel || '',
        lastSyncedAt: conn?.lastSyncedAt ?? null,
      };
    });
  }

  async getStatus(userId: string, source: string) {
    const item = this.requireCatalog(source);
    if (source === 'github') {
      const github = await this.githubService.getStatus(userId);
      return { ...item, ...github };
    }
    if (source === 'manual') {
      return { ...item, connected: true, accountLabel: 'Always on' };
    }
    const conn = await this.connectionRepository
      .findOne({ userId, source: this.asSource(source) })
      .exec();
    if (!conn) return { ...item, connected: false };
    return {
      ...item,
      connected: true,
      accountLabel: conn.accountLabel,
      lastSyncedAt: conn.lastSyncedAt,
    };
  }

  async connect(userId: string, source: string, dto: ConnectConnectorDto) {
    const item = this.requireCatalog(source);

    if (source === 'github') {
      if (!dto.accessToken) {
        throw new BadRequestException('accessToken is required for GitHub');
      }
      return this.githubService.connect(userId, dto.accessToken);
    }

    if (source === 'manual') {
      return { connected: true, source, accountLabel: 'Always on' };
    }

    if (item.mode === 'extension') {
      await this.upsertConnection(userId, source, {
        accountLabel: dto.accountLabel || `${item.name} extension`,
        credentials: {},
        meta: { ...(dto.meta ?? {}), mode: 'extension' },
      });
      return {
        connected: true,
        source,
        accountLabel: dto.accountLabel || `${item.name} extension`,
        hint: `Install the ${item.name} extension and push events to POST /connectors/ingest`,
      };
    }

    const token = dto.accessToken || dto.apiKey;
    if (!token) {
      throw new BadRequestException(
        `${item.name} requires accessToken (or apiKey). OAuth apps can be wired later; for now paste a token.`,
      );
    }

    // Light validation per provider
    const accountLabel =
      dto.accountLabel ||
      (await this.validateAndLabel(source, token, dto.refreshToken));

    await this.upsertConnection(userId, source, {
      accountLabel,
      credentials: {
        accessToken: dto.accessToken,
        refreshToken: dto.refreshToken,
        apiKey: dto.apiKey,
      },
      meta: dto.meta ?? {},
    });

    return { connected: true, source, accountLabel };
  }

  async disconnect(userId: string, source: string) {
    this.requireCatalog(source);
    if (source === 'github') {
      throw new BadRequestException(
        'Disconnect GitHub via reconnecting with a new token for now (GitHub module).',
      );
    }
    if (source === 'manual') {
      return { disconnected: false, message: 'Manual cannot be disconnected' };
    }
    await this.connectionRepository
      .deleteOne({ userId, source: this.asSource(source) })
      .exec();
    return { disconnected: true, source };
  }

  async sync(userId: string, source: string) {
    const item = this.requireCatalog(source);

    if (source === 'github') {
      return this.githubService.sync(userId);
    }

    if (!item.syncSupported) {
      return {
        synced: 0,
        skipped: 0,
        updated: 0,
        message: `${item.name} is ingest/extension based. Use POST /connectors/ingest or the extension.`,
      };
    }

    const conn = await this.requireConnection(userId, source);
    const creds = this.decryptCredentials(conn);
    const token = creds.accessToken || creds.apiKey;
    if (!token) {
      throw new BadRequestException(`${item.name} is connected without a token`);
    }

    let events: CreateEventDto[] = [];
    switch (source) {
      case 'notion':
        events = await this.syncNotion(token);
        break;
      case 'slack':
        events = await this.syncSlack(token);
        break;
      case 'gmail':
        events = await this.syncGmail(token);
        break;
      case 'calendar':
        events = await this.syncCalendar(token);
        break;
      case 'drive':
        events = await this.syncDrive(token);
        break;
      default:
        throw new BadRequestException(`Sync not implemented for ${source}`);
    }

    let synced = 0;
    let skipped = 0;
    let updated = 0;
    for (const dto of events) {
      const result = await this.eventService.upsertBySourceEventId(userId, {
        ...dto,
        source: source as CreateEventDto['source'],
      });
      if (result === 'created') synced++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    conn.lastSyncedAt = new Date();
    await conn.save();

    return { synced, skipped, updated, source };
  }

  async ingest(userId: string, dto: IngestEventsDto) {
    this.requireCatalog(dto.source);

    let synced = 0;
    let skipped = 0;
    let updated = 0;

    for (const item of dto.events) {
      const result = await this.eventService.upsertBySourceEventId(userId, {
        source: dto.source,
        type: item.type,
        title: item.title,
        content: item.content,
        summary: item.summary,
        occurredAt: item.occurredAt,
        projectId: item.projectId,
        tags: item.tags,
        sourceEventId: item.sourceEventId,
        metadata: item.metadata,
      });
      if (result === 'created') synced++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    // Mark extension connectors as connected on first ingest
    if (['vscode', 'chrome', 'photos'].includes(dto.source)) {
      await this.upsertConnection(userId, dto.source, {
        accountLabel: `${dto.source} collector`,
        credentials: {},
        meta: { lastIngestAt: new Date().toISOString() },
      });
    }

    return { source: dto.source, synced, skipped, updated };
  }

  async createManualNote(userId: string, dto: ManualNoteDto) {
    const occurredAt = dto.occurredAt ?? new Date().toISOString();
    const event = await this.eventService.createEvent(userId, {
      source: 'manual',
      type: 'note',
      title: dto.title,
      content: dto.content ?? '',
      occurredAt,
      projectId: dto.projectId,
      tags: dto.tags ?? ['manual'],
      sourceEventId: `manual-${userId}-${Date.now()}`,
      metadata: { origin: 'manual-note' },
    });
    return event;
  }

  private asSource(source: string): EventSource {
    if (!(EVENT_SOURCES as readonly string[]).includes(source)) {
      throw new BadRequestException(`Unknown connector source: ${source}`);
    }
    return source as EventSource;
  }

  private requireCatalog(source: string) {
    const item = getCatalogItem(source);
    if (!item) {
      throw new BadRequestException(`Unknown connector source: ${source}`);
    }
    return item;
  }

  private async requireConnection(
    userId: string,
    source: string,
  ): Promise<ConnectorConnectionDocument> {
    const conn = await this.connectionRepository
      .findOne({ userId, source: this.asSource(source) })
      .exec();
    if (!conn) {
      throw new NotFoundException(
        `${source} not connected. POST /connectors/${source}/connect first.`,
      );
    }
    return conn as ConnectorConnectionDocument;
  }

  private async upsertConnection(
    userId: string,
    source: string,
    data: {
      accountLabel: string;
      credentials: StoredCredentials;
      meta: Record<string, unknown>;
    },
  ) {
    const credentialsEnc =
      data.credentials.accessToken ||
      data.credentials.refreshToken ||
      data.credentials.apiKey
        ? this.encryptionService.encrypt(JSON.stringify(data.credentials))
        : null;

    await this.connectionRepository.findOneAndUpdate(
      { userId, source: this.asSource(source) },
      {
        userId,
        source: this.asSource(source),
        accountLabel: data.accountLabel,
        credentialsEnc,
        enabled: true,
        meta: data.meta,
      },
      { upsert: true, new: true },
    );
  }

  private decryptCredentials(
    conn: ConnectorConnectionDocument,
  ): StoredCredentials {
    if (!conn.credentialsEnc) return {};
    try {
      return JSON.parse(
        this.encryptionService.decrypt(conn.credentialsEnc),
      ) as StoredCredentials;
    } catch {
      throw new BadRequestException(
        'Failed to decrypt connector credentials. Reconnect the source.',
      );
    }
  }

  private async validateAndLabel(
    source: string,
    token: string,
    _refresh?: string,
  ): Promise<string> {
    try {
      if (source === 'notion') {
        const res = await fetch('https://api.notion.com/v1/users/me', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (!res.ok) throw new Error('invalid');
        const data = (await res.json()) as { name?: string; bot?: { owner?: { user?: { name?: string } } } };
        return data.name || data.bot?.owner?.user?.name || 'Notion';
      }
      if (source === 'slack') {
        const res = await fetch('https://slack.com/api/auth.test', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as {
          ok: boolean;
          user?: string;
          team?: string;
        };
        if (!data.ok) throw new Error('invalid');
        return data.user || data.team || 'Slack';
      }
      if (source === 'gmail' || source === 'calendar' || source === 'drive') {
        const res = await fetch(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error('invalid');
        const data = (await res.json()) as { email?: string };
        return data.email || 'Google';
      }
    } catch {
      // Allow connect anyway for local/dev tokens; label from source
      return source;
    }
    return source;
  }

  private async syncNotion(token: string): Promise<CreateEventDto[]> {
    const res = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 25 }),
    });
    if (!res.ok) {
      throw new BadRequestException(`Notion API error: ${res.status}`);
    }
    const data = (await res.json()) as {
      results?: Array<{
        id: string;
        object: string;
        last_edited_time?: string;
        created_time?: string;
        properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
        url?: string;
      }>;
    };

    return (data.results ?? [])
      .filter((r) => r.object === 'page')
      .map((page) => {
        const titleProp = Object.values(page.properties ?? {}).find(
          (p) => Array.isArray(p.title),
        );
        const title =
          titleProp?.title?.map((t) => t.plain_text).join('') || 'Notion page';
        return {
          source: 'notion' as const,
          type: 'note' as const,
          title,
          content: page.url ?? '',
          occurredAt: page.last_edited_time || page.created_time || new Date().toISOString(),
          sourceEventId: `notion-${page.id}`,
          tags: ['notion'],
          metadata: { pageId: page.id, url: page.url },
        };
      });
  }

  private async syncSlack(token: string): Promise<CreateEventDto[]> {
    const auth = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json()) as { ok: boolean; user_id?: string };

    if (!auth.ok) {
      throw new BadRequestException('Invalid Slack token');
    }

    const hist = await fetch(
      'https://slack.com/api/conversations.history?limit=30',
      { headers: { Authorization: `Bearer ${token}` } },
    ).then((r) => r.json()) as {
      ok: boolean;
      error?: string;
      messages?: Array<{ ts: string; text?: string; user?: string }>;
    };

    if (!hist.ok) {
      // conversations.history needs a channel — return empty with guidance via exception message for channel-less tokens
      if (hist.error === 'channel_not_found' || hist.error === 'missing_scope') {
        return [];
      }
      throw new BadRequestException(`Slack API error: ${hist.error}`);
    }

    return (hist.messages ?? []).map((m) => ({
      source: 'slack' as const,
      type: 'message' as const,
      title: (m.text || 'Slack message').slice(0, 120),
      content: m.text || '',
      occurredAt: new Date(Number(m.ts) * 1000).toISOString(),
      sourceEventId: `slack-${m.ts}`,
      tags: ['slack'],
      metadata: { user: m.user, ts: m.ts },
    }));
  }

  private async syncGmail(token: string): Promise<CreateEventDto[]> {
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) {
      throw new BadRequestException(`Gmail API error: ${listRes.status}`);
    }
    const list = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
    };

    const events: CreateEventDto[] = [];
    for (const msg of (list.messages ?? []).slice(0, 15)) {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!detailRes.ok) continue;
      const detail = (await detailRes.json()) as {
        id: string;
        snippet?: string;
        internalDate?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const headers = detail.payload?.headers ?? [];
      const subject =
        headers.find((h) => h.name.toLowerCase() === 'subject')?.value ||
        'Email';
      const from =
        headers.find((h) => h.name.toLowerCase() === 'from')?.value || '';
      const occurredAt = detail.internalDate
        ? new Date(Number(detail.internalDate)).toISOString()
        : new Date().toISOString();
      events.push({
        source: 'gmail',
        type: 'email',
        title: subject,
        content: `${from}\n${detail.snippet ?? ''}`.trim(),
        occurredAt,
        sourceEventId: `gmail-${detail.id}`,
        tags: ['gmail'],
        metadata: { messageId: detail.id, from },
      });
    }
    return events;
  }

  private async syncCalendar(token: string): Promise<CreateEventDto[]> {
    const timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
      `?maxResults=30&singleEvents=true&orderBy=startTime` +
      `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new BadRequestException(`Calendar API error: ${res.status}`);
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        htmlLink?: string;
      }>;
    };

    return (data.items ?? []).map((ev) => ({
      source: 'calendar' as const,
      type: 'meeting' as const,
      title: ev.summary || 'Calendar event',
      content: ev.description || ev.htmlLink || '',
      occurredAt: ev.start?.dateTime || ev.start?.date || new Date().toISOString(),
      sourceEventId: `calendar-${ev.id}`,
      tags: ['calendar'],
      metadata: { eventId: ev.id, end: ev.end, htmlLink: ev.htmlLink },
    }));
  }

  private async syncDrive(token: string): Promise<CreateEventDto[]> {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files?pageSize=25&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new BadRequestException(`Drive API error: ${res.status}`);
    }
    const data = (await res.json()) as {
      files?: Array<{
        id: string;
        name?: string;
        mimeType?: string;
        modifiedTime?: string;
        webViewLink?: string;
      }>;
    };

    return (data.files ?? []).map((f) => ({
      source: 'drive' as const,
      type: 'file' as const,
      title: f.name || 'Drive file',
      content: f.webViewLink || f.mimeType || '',
      occurredAt: f.modifiedTime || new Date().toISOString(),
      sourceEventId: `drive-${f.id}`,
      tags: ['drive'],
      metadata: { fileId: f.id, mimeType: f.mimeType },
    }));
  }
}
