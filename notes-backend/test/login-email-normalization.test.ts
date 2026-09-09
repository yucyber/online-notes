import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { AuthService } from '../src/modules/auth/auth.service'
import { CreateUserDto, LoginUserDto } from '../src/modules/users/dto'
import { UsersService } from '../src/modules/users/users.service'

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
const validate = (metatype: any, value: unknown) => pipe.transform(value, { type: 'body', metatype })

function fixture(emails: string[] = []) {
  const records: any[] = emails.map(email => ({ email, password: 'secret1', id: email, comparePassword: async (password: string) => password === 'secret1' }))
  const queries: (string | RegExp)[] = []
  class UserModel {
    constructor(private input: any) {}
    async save() {
      const user = { ...this.input, id: this.input.email, comparePassword: async (password: string) => password === this.input.password }
      records.push(user)
      return user
    }
    static async findOne({ email }: { email: string | RegExp }) {
      queries.push(email)
      return records.find(user => email instanceof RegExp ? email.test(user.email) : user.email === email) || null
    }
  }
  const users = new UsersService(UserModel as any)
  const auth = new AuthService(users, { sign: () => 'token' } as any, { consumeCode: async () => {} } as any)
  return { users, auth, queries }
}

test('LoginUserDto 去除邮箱首尾空格并转换大小写', async () => {
  const dto = await validate(LoginUserDto, { email: '  User@Example.COM  ', password: 'secret1' })
  assert.equal(dto.email, 'user@example.com')
})

test('绕过 DTO 的登录在 UsersService 查询边界仍使用规范化邮箱', async () => {
  const { auth, queries } = fixture(['user@example.com'])
  const result = await auth.login({ email: '  User@Example.COM  ', password: 'secret1' })
  assert.equal(result.user.email, 'user@example.com')
  assert.equal(queries[0], 'user@example.com')
})

test('混合大小写注册后用同样邮箱输入可以重新登录', async () => {
  const { auth } = fixture()
  await auth.register(await validate(CreateUserDto, { email: 'User@Example.COM', password: 'secret1', verificationCode: '012345' }))
  const result = await auth.login(await validate(LoginUserDto, { email: 'User@Example.COM', password: 'secret1' }))
  assert.equal(result.user.email, 'user@example.com')
})

test('规范化登录仍兼容历史混合大小写邮箱', async () => {
  const { auth } = fixture(['Old.User+tag@Example.COM'])
  const result = await auth.login(await validate(LoginUserDto, { email: 'old.user+tag@example.com', password: 'secret1' }))
  assert.equal(result.user.email, 'Old.User+tag@Example.COM')
})

test('历史邮箱回退不会把正则特殊字符或部分匹配当成同一个账号', async () => {
  const { users } = fixture(['oldXuser@example.com', 'prefix-old.user@example.com'])
  assert.equal(await users.validateUser('old.user@example.com', 'secret1'), null)
})

test('存在历史大小写重复账号时优先精确小写账号', async () => {
  const { auth } = fixture(['User@Example.COM', 'user@example.com'])
  const result = await auth.login({ email: 'USER@EXAMPLE.COM', password: 'secret1' })
  assert.equal(result.user.email, 'user@example.com')
})
