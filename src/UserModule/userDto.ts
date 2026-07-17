import { IsString, IsEmail, IsNotEmpty } from 'class-validator';
// import { Transform } from 'class-transformer';

export class UserDto {
    @IsString()
    name: string | undefined;

    @IsEmail()
    email: string | undefined;

    @IsString()
    password: string | undefined;
}