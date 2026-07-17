import { Controller, Post, Body } from '@nestjs/common';
import { UserDto } from './userDto';
import { UserService } from './userService';

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Post('create')
    async createUser(@Body() userDto: UserDto) {
        console.log('userDto in controller', userDto);
        return this.userService.createUser(userDto);
    }
}