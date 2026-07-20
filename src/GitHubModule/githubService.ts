import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { CreateEventDto } from '../EventModule/eventDto';
import { EventService } from '../EventModule/eventService';
import GitHubConnectionEntity, {
  GitHubConnectionDocument,
} from './githubConnectionEntity';

type GitHubUser = { login: string; id: number };

type GitHubApiEvent = {
  id: string;
  type: string;
  repo: { name: string };
  payload: Record<string, unknown>;
  created_at: string;
};

@Injectable()
export class GitHubService {
  private readonly apiBase = 'https://api.github.com';

  constructor(
    @Inject('GITHUB_CONNECTION_REPOSITORY')
    private readonly connectionRepository: typeof GitHubConnectionEntity,
    private readonly eventService: EventService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async connect(
    userId: string,
    accessToken: string,
  ): Promise<{ connected: true; username: string }> {
    const user = await this.fetchGitHubUser(accessToken);
    const encryptedToken = this.encryptionService.encrypt(accessToken);

    await this.connectionRepository.findOneAndUpdate(
      { userId },
      {
        userId,
        githubUsername: user.login,
        accessToken: encryptedToken,
      },
      { upsert: true, new: true },
    );

    return { connected: true, username: user.login };
  }

  async getStatus(userId: string) {
    const conn = await this.connectionRepository.findOne({ userId }).exec();
    if (!conn) {
      return { connected: false };
    }
    return {
      connected: true,
      username: conn.githubUsername,
      lastSyncedAt: conn.lastSyncedAt,
    };
  }

  async sync(userId: string): Promise<{ synced: number; skipped: number }> {
    const conn = await this.getConnection(userId);
    const plainToken = this.encryptionService.decrypt(conn.accessToken);
    const ghEvents = await this.fetchUserEvents(
      plainToken,
      conn.githubUsername,
    );

    const eventDtos = ghEvents.map((gh) => this.mapGitHubEventToDto(gh));

    let synced = 0;
    let skipped = 0;

    for (const dto of eventDtos) {
      try {
        await this.eventService.createEvent(userId, dto);
        synced++;
      } catch (err) {
        if (err instanceof ConflictException) {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    conn.lastSyncedAt = new Date();
    await conn.save();

    return { synced, skipped };
  }

  private async getConnection(
    userId: string,
  ): Promise<GitHubConnectionDocument> {
    const conn = await this.connectionRepository.findOne({ userId }).exec();
    if (!conn) {
      throw new NotFoundException(
        'GitHub not connected. POST /connectors/github/connect first.',
      );
    }
    return conn;
  }

  private async fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
    const res = await fetch(`${this.apiBase}/user`, {
      headers: this.authHeaders(accessToken),
    });

    if (!res.ok) {
      throw new BadRequestException(
        'Invalid GitHub token. Create a PAT with repo scope at github.com/settings/tokens',
      );
    }

    return res.json() as Promise<GitHubUser>;
  }

  private async fetchUserEvents(
    accessToken: string,
    username: string,
  ): Promise<GitHubApiEvent[]> {
    // Prefer authenticated events (includes private). Fall back to public events.
    const endpoints = [
      `${this.apiBase}/user/events?per_page=100`,
      `${this.apiBase}/users/${encodeURIComponent(username)}/events?per_page=100`,
      `${this.apiBase}/users/${encodeURIComponent(username)}/events/public?per_page=100`,
    ];

    let lastStatus = 0;
    let lastStatusText = '';

    for (const url of endpoints) {
      const res = await fetch(url, {
        headers: this.authHeaders(accessToken),
      });

      if (res.ok) {
        return res.json() as Promise<GitHubApiEvent[]>;
      }

      lastStatus = res.status;
      lastStatusText = res.statusText;

      // Retry next endpoint for 404/403 (common with missing scopes / fine-grained PATs)
      if (res.status !== 404 && res.status !== 403) {
        break;
      }
    }

    throw new BadRequestException(
      `GitHub API error: ${lastStatus} ${lastStatusText}. ` +
        'Create a Classic PAT with the "repo" scope checked (not Fine-grained), ' +
        'then reconnect in the app. Tokens with no scopes can connect but cannot sync.',
    );
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  mapGitHubEventToDto(gh: GitHubApiEvent): CreateEventDto {
    const repo = gh.repo.name;
    const payload = gh.payload;
    const { type, title, content } = this.resolveEventContent(
      gh.type,
      repo,
      payload,
    );

    return {
      source: 'github',
      type,
      title,
      content,
      occurredAt: gh.created_at,
      projectId: repo,
      sourceEventId: `github-${gh.id}`,
      tags: [gh.type],
      metadata: {
        githubEventType: gh.type,
        repo,
        payload,
      },
    };
  }

  private resolveEventContent(
    ghType: string,
    repo: string,
    payload: Record<string, unknown>,
  ): { type: CreateEventDto['type']; title: string; content: string } {
    switch (ghType) {
      case 'PushEvent': {
        const commits = (payload.commits as { message: string }[]) ?? [];
        const head = (payload.head as string) ?? '';
        const messages = commits.map((c) => c.message).join('\n');
        return {
          type: 'commit',
          title: `Push to ${repo}${head ? ` (${head.slice(0, 7)})` : ''}`,
          content: messages || `Pushed ${commits.length} commit(s)`,
        };
      }
      case 'PullRequestEvent': {
        const pr = payload.pull_request as {
          number: number;
          title: string;
          body: string | null;
        };
        const action = (payload.action as string) ?? 'updated';
        return {
          type: 'message',
          title: `PR #${pr?.number ?? '?'}: ${pr?.title ?? repo} (${action})`,
          content: pr?.body ?? '',
        };
      }
      case 'IssuesEvent': {
        const issue = payload.issue as {
          number: number;
          title: string;
          body: string | null;
        };
        const action = (payload.action as string) ?? 'updated';
        return {
          type: 'note',
          title: `Issue #${issue?.number ?? '?'}: ${issue?.title ?? repo} (${action})`,
          content: issue?.body ?? '',
        };
      }
      case 'CreateEvent': {
        const refType = (payload.ref_type as string) ?? 'resource';
        const ref = (payload.ref as string) ?? '';
        return {
          type: 'other',
          title: `Created ${refType}${ref ? ` ${ref}` : ''} in ${repo}`,
          content: '',
        };
      }
      case 'WatchEvent':
        return {
          type: 'other',
          title: `Starred ${repo}`,
          content: '',
        };
      case 'ForkEvent':
        return {
          type: 'other',
          title: `Forked ${repo}`,
          content: '',
        };
      case 'DeleteEvent': {
        const refType = (payload.ref_type as string) ?? 'resource';
        return {
          type: 'other',
          title: `Deleted ${refType} in ${repo}`,
          content: '',
        };
      }
      default:
        return {
          type: 'other',
          title: `${ghType} on ${repo}`,
          content: JSON.stringify(payload).slice(0, 500),
        };
    }
  }
}
