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

export type GitHubProject = {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  pushed_at: string | null;
  private: boolean;
};

type GitHubRepoApi = {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  pushed_at: string | null;
  private: boolean;
};

type GitHubCommitApi = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name?: string; email?: string; date?: string } | null;
    committer: { name?: string; email?: string; date?: string } | null;
  };
  author: { login?: string } | null;
};

@Injectable()
export class GitHubService {
  private readonly apiBase = 'https://api.github.com';
  private readonly commitsPerRepo = 30;

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

  async listProjects(userId: string): Promise<{ projects: GitHubProject[] }> {
    const conn = await this.getConnection(userId);
    const plainToken = this.encryptionService.decrypt(conn.accessToken);
    const projects = await this.fetchUserRepos(plainToken);
    return { projects };
  }

  async sync(
    userId: string,
  ): Promise<{ synced: number; skipped: number; updated: number }> {
    const conn = await this.getConnection(userId);
    const plainToken = this.encryptionService.decrypt(conn.accessToken);
    const projects = await this.fetchUserRepos(plainToken);

    let synced = 0;
    let skipped = 0;
    let updated = 0;

    for (const project of projects) {
      const counts = await this.syncRepoCommits(
        userId,
        plainToken,
        project.full_name,
        conn.githubUsername,
      );
      synced += counts.synced;
      skipped += counts.skipped;
      updated += counts.updated;
    }

    conn.lastSyncedAt = new Date();
    await conn.save();

    return { synced, skipped, updated };
  }

  async syncProject(
    userId: string,
    owner: string,
    repo: string,
  ): Promise<{ synced: number; skipped: number; updated: number; projectId: string }> {
    const conn = await this.getConnection(userId);
    const plainToken = this.encryptionService.decrypt(conn.accessToken);
    const projectId = `${owner}/${repo}`;

    const counts = await this.syncRepoCommits(
      userId,
      plainToken,
      projectId,
      conn.githubUsername,
    );

    conn.lastSyncedAt = new Date();
    await conn.save();

    return { ...counts, projectId };
  }

  private async syncRepoCommits(
    userId: string,
    accessToken: string,
    fullName: string,
    authorLogin: string,
  ): Promise<{ synced: number; skipped: number; updated: number }> {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) {
      return { synced: 0, skipped: 0, updated: 0 };
    }

    const commits = await this.fetchRepoCommits(
      accessToken,
      owner,
      repo,
      authorLogin,
    );

    let synced = 0;
    let skipped = 0;
    let updated = 0;

    for (const commit of commits) {
      const dto = this.mapCommitToDto(fullName, commit);
      const result = await this.eventService.upsertBySourceEventId(userId, dto);
      if (result === 'created') synced++;
      else if (result === 'updated') updated++;
      else skipped++;
    }

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

  private async fetchUserRepos(accessToken: string): Promise<GitHubProject[]> {
    const url =
      `${this.apiBase}/user/repos` +
      `?affiliation=owner,collaborator&sort=pushed&per_page=100`;
    const res = await fetch(url, {
      headers: this.authHeaders(accessToken),
    });

    if (!res.ok) {
      throw new BadRequestException(
        `GitHub API error: ${res.status} ${res.statusText}. ` +
          'Create a Classic PAT with the "repo" scope checked (not Fine-grained), ' +
          'then reconnect in the app.',
      );
    }

    const repos = (await res.json()) as GitHubRepoApi[];
    return repos.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      html_url: r.html_url,
      pushed_at: r.pushed_at,
      private: r.private,
    }));
  }

  private async fetchRepoCommits(
    accessToken: string,
    owner: string,
    repo: string,
    authorLogin: string,
  ): Promise<GitHubCommitApi[]> {
    const params = new URLSearchParams({
      per_page: String(this.commitsPerRepo),
      author: authorLogin,
    });
    const url = `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params}`;
    const res = await fetch(url, {
      headers: this.authHeaders(accessToken),
    });

    // Empty / inaccessible repos should not fail the whole sync
    if (res.status === 409 || res.status === 404) {
      return [];
    }

    if (!res.ok) {
      throw new BadRequestException(
        `GitHub commits API error for ${owner}/${repo}: ${res.status} ${res.statusText}`,
      );
    }

    return res.json() as Promise<GitHubCommitApi[]>;
  }

  mapCommitToDto(fullName: string, commit: GitHubCommitApi): CreateEventDto {
    const message = commit.commit?.message?.trim() ?? '';
    const firstLine = message.split('\n')[0] || `Commit ${commit.sha.slice(0, 7)}`;
    const occurredAt =
      commit.commit?.author?.date ??
      commit.commit?.committer?.date ??
      new Date().toISOString();

    return {
      source: 'github',
      type: 'commit',
      title: firstLine,
      content: message,
      occurredAt,
      projectId: fullName,
      sourceEventId: `github-commit-${commit.sha}`,
      tags: ['commit'],
      metadata: {
        sha: commit.sha,
        html_url: commit.html_url,
        repo: fullName,
      },
    };
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}
