import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../AuthModule/auth.dto';
import { JwtAuthGuard } from '../AuthModule/jwt-auth.guard';
import { CurrentUser } from '../AuthModule/current-user.decorator';
import { AiAskDto, AiDaySummaryDto, AiSearchDto } from './aiDto';
import { AiService } from './aiService';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /** Natural language: "What was I doing yesterday on Docker-learning?" */
  @Post('ask')
  async ask(@CurrentUser() user: AuthUser, @Body() dto: AiAskDto) {
    return this.aiService.ask(user.userId, dto);
  }

  /** Ranked moment search (no narrative required). */
  @Post('search')
  async search(@CurrentUser() user: AuthUser, @Body() dto: AiSearchDto) {
    return this.aiService.search(user.userId, dto);
  }

  /** One-shot day summary for Replay. */
  @Post('day-summary')
  async daySummary(
    @CurrentUser() user: AuthUser,
    @Body() dto: AiDaySummaryDto,
  ) {
    return this.aiService.daySummary(user.userId, dto);
  }
}
