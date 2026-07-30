import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EVENT_SOURCES } from '../EventModule/eventDto';

export class AiAskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;

  /** YYYY-MM-DD — ask about a specific local day */
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(EVENT_SOURCES)
  source?: (typeof EVENT_SOURCES)[number];

  @IsOptional()
  @IsString()
  timezone?: string;
}

export class AiSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(EVENT_SOURCES)
  source?: (typeof EVENT_SOURCES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AiDaySummaryDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}
