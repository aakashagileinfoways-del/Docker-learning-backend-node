import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export type JwtPayload = {
  sub: string;
  email: string;
  tier: string;
};

export type AuthUser = {
  userId: string;
  email: string;
  tier: string;
};
