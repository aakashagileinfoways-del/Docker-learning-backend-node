import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    console.log('Hello this is Aakash Sharma!');
    return 'Hello World!';
  }
}
