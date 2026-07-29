import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../AuthModule/auth.dto';
import { JwtAuthGuard } from '../AuthModule/jwt-auth.guard';
import { CurrentUser } from '../AuthModule/current-user.decorator';
import { ConnectGitHubDto } from './githubDto';
import { GitHubService } from './githubService';

@Controller('connectors/github')
@UseGuards(JwtAuthGuard)
export class GitHubController {
  constructor(private readonly githubService: GitHubService) {}

  @Post('connect')
  async connect(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConnectGitHubDto,
  ) {
    return this.githubService.connect(user.userId, dto.accessToken);
  }

  @Post('sync')
  async sync(@CurrentUser() user: AuthUser) {
    return this.githubService.sync(user.userId);
  }

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    return this.githubService.getStatus(user.userId);
  }

  @Get('projects')
  async listProjects(@CurrentUser() user: AuthUser) {
    return this.githubService.listProjects(user.userId);
  }

  @Post('projects/:owner/:repo/sync')
  async syncProject(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ) {
    return this.githubService.syncProject(user.userId, owner, repo);
  }
}
