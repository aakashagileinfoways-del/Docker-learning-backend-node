import mongoose, { InferSchemaType, HydratedDocument } from 'mongoose';

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
});

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

const UserEntity = mongoose.model('User', userSchema);

export default UserEntity;
