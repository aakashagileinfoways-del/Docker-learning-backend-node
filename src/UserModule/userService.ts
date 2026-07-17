import { Inject, Injectable } from '@nestjs/common';
import { UserDto } from './userDto';
import UserEntity, { UserDocument } from './userEntity';

@Injectable()
export class UserService {
  constructor(
    @Inject('USER_REPOSITORY')
    private readonly userRepository: typeof UserEntity,
  ) {}

  async createUser(userDto: UserDto): Promise<UserDocument> {
    return this.userRepository.create({
      name: userDto.name,
      email: userDto.email,
      password: userDto.password,
    });
  }
}
