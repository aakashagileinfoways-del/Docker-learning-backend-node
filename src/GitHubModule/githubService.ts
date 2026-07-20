import {
  BadRequestException,
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

type GitHubCommit = {
  sha: string;
  commit: { message: string };
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

  async sync(
    userId: string,
  ): Promise<{ synced: number; skipped: number; updated: number }> {
    const conn = await this.getConnection(userId);
    const plainToken = this.encryptionService.decrypt(conn.accessToken);
    const ghEvents = await this.fetchUserEvents(
      plainToken,
      conn.githubUsername,
    );

    let synced = 0;
    let skipped = 0;
    let updated = 0;

    for (const gh of ghEvents) {
      const dto = await this.mapGitHubEventToDto(gh, plainToken);
      const result = await this.eventService.upsertBySourceEventId(
        userId,
        dto,
      );
      if (result === 'created') synced++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

    conn.lastSyncedAt = new Date();
    await conn.save();

    return { synced, skipped, updated };
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

  /**
   * Events API often omits payload.commits. Fetch messages via Commits API.
   */
  private async resolvePushCommitMessages(
    accessToken: string,
    repo: string,
    payload: Record<string, unknown>,
  ): Promise<{ messages: string[]; shortSha: string }> {
    const head = (payload.head as string) ?? '';
    const before = (payload.before as string) ?? '';
    const shortSha = head ? head.slice(0, 7) : '';

    const fromPayload = (payload.commits as { message?: string }[]) ?? [];
    const payloadMessages = fromPayload
      .map((c) => c.message?.trim())
      .filter((m): m is string => !!m);

    if (payloadMessages.length > 0) {
      return { messages: payloadMessages, shortSha };
    }

    if (!head || !repo.includes('/')) {
      return { messages: [], shortSha };
    }

    // Prefer compare when we have before → head (multi-commit pushes)
    const zeroSha = /^0+$/;
    if (before && !zeroSha.test(before) && before !== head) {
      const compareUrl = `${this.apiBase}/repos/${repo}/compare/${before}...${head}`;
      const compareRes = await fetch(compareUrl, {
        headers: this.authHeaders(accessToken),
      });
      if (compareRes.ok) {
        const data = (await compareRes.json()) as {
          commits?: GitHubCommit[];
        };
        const messages =
          data.commits
            ?.map((c) => c.commit?.message?.trim())
            .filter((m): m is string => !!m) ?? [];
        if (messages.length > 0) {
          return { messages, shortSha };
        }
      }
    }

    // Fallback: single commit by head SHA
    const commitUrl = `${this.apiBase}/repos/${repo}/commits/${head}`;
    const commitRes = await fetch(commitUrl, {
      headers: this.authHeaders(accessToken),
    });
    if (commitRes.ok) {
      const data = (await commitRes.json()) as GitHubCommit;
      const message = data.commit?.message?.trim();
      if (message) {
        return { messages: [message], shortSha };
      }
    }

    return { messages: [], shortSha };
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async mapGitHubEventToDto(
    gh: GitHubApiEvent,
    accessToken: string,
  ): Promise<CreateEventDto> {
    const repo = gh.repo.name;
    const payload = gh.payload;
    const { type, title, content } = await this.resolveEventContent(
      gh.type,
      repo,
      payload,
      accessToken,
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

  private async resolveEventContent(
    ghType: string,
    repo: string,
    payload: Record<string, unknown>,
    accessToken: string,
  ): Promise<{ type: CreateEventDto['type']; title: string; content: string }> {
    switch (ghType) {
      case 'PushEvent': {
        const { messages, shortSha } = await this.resolvePushCommitMessages(
          accessToken,
          repo,
          payload,
        );
        const firstLine = messages[0]?.split('\n')[0] ?? '';
        const title = firstLine
          ? `${firstLine}${shortSha ? ` (${shortSha})` : ''}`
          : `Push to ${repo}${shortSha ? ` (${shortSha})` : ''}`;
        const content =
          messages.length > 0
            ? messages.join('\n\n')
            : `Push to ${repo}${shortSha ? ` @ ${shortSha}` : ''}`;
        return { type: 'commit', title, content };
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
