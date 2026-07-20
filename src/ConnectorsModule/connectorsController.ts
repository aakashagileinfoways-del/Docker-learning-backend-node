import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../AuthModule/auth.dto';
import { JwtAuthGuard } from '../AuthModule/jwt-auth.guard';
import { CurrentUser } from '../AuthModule/current-user.decorator';
import {
  ConnectConnectorDto,
  IngestEventsDto,
  ManualNoteDto,
} from './connectorsDto';
import { ConnectorsService } from './connectorsService';

@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.connectorsService.listStatuses(user.userId);
  }

  @Get('catalog')
  catalog() {
    return this.connectorsService.listCatalog();
  }

  /** VS Code / Chrome / Photos / any collector */
  @Post('ingest')
  async ingest(@CurrentUser() user: AuthUser, @Body() dto: IngestEventsDto) {
    return this.connectorsService.ingest(user.userId, dto);
  }

  @Post('manual/note')
  async manualNote(@CurrentUser() user: AuthUser, @Body() dto: ManualNoteDto) {
    return this.connectorsService.createManualNote(user.userId, dto);
  }

  @Get(':source/status')
  async status(
    @CurrentUser() user: AuthUser,
    @Param('source') source: string,
  ) {
    return this.connectorsService.getStatus(user.userId, source);
  }

  @Post(':source/connect')
  async connect(
    @CurrentUser() user: AuthUser,
    @Param('source') source: string,
    @Body() dto: ConnectConnectorDto,
  ) {
    return this.connectorsService.connect(user.userId, source, dto);
  }

  @Delete(':source')
  async disconnect(
    @CurrentUser() user: AuthUser,
    @Param('source') source: string,
  ) {
    return this.connectorsService.disconnect(user.userId, source);
  }

  @Post(':source/sync')
  async sync(@CurrentUser() user: AuthUser, @Param('source') source: string) {
    return this.connectorsService.sync(user.userId, source);
  }
}
