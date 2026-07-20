import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EVENT_SOURCES, EVENT_TYPES } from '../EventModule/eventDto';

export class ConnectConnectorDto {
  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  accountLabel?: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class IngestEventItemDto {
  @IsIn(EVENT_TYPES)
  type!: (typeof EVENT_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsDateString()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  sourceEventId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class IngestEventsDto {
  @IsIn(EVENT_SOURCES)
  source!: (typeof EVENT_SOURCES)[number];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestEventItemDto)
  events!: IngestEventItemDto[];
}

export class ManualNoteDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
