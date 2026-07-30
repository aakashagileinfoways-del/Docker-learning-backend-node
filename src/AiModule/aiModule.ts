import { Module } from '@nestjs/common';
import { EventModule } from '../EventModule/eventModule';
import { AiController } from './aiController';
import { AiService } from './aiService';
import { LlmClient } from './llm.client';

@Module({
  imports: [EventModule],
  controllers: [AiController],
  providers: [AiService, LlmClient],
  exports: [AiService],
})
export class AiModule {}
