import { Module } from '@nestjs/common';
import { UserController } from './userController';
import { UserService } from './userService';
import UserEntity from './userEntity';
@Module({
    controllers: [UserController],
    providers: [UserService, {
        provide: 'USER_REPOSITORY',
        useValue: UserEntity,
    }],
})
export class UserModule {}