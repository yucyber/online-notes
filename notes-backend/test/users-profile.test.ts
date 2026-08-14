import { test } from 'node:test'
import assert = require('node:assert/strict')
import { ValidationPipe } from '@nestjs/common'
import { UpdateProfileDto } from '../src/modules/users/dto/update-profile.dto'
import { UsersService } from '../src/modules/users/users.service'
import { UsersController } from '../src/modules/users/users.controller'
import { AuthService } from '../src/modules/auth/auth.service'

test('UpdateProfileDto trims displayName and accepts a 1-32 character value', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

  const result = await pipe.transform(
    { displayName: '  林默  ' },
    { type: 'body', metatype: UpdateProfileDto, data: '' },
  ) as UpdateProfileDto

  assert.equal(result.displayName, '林默')
})

test('UpdateProfileDto rejects blank and overlong display names', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })

  await assert.rejects(() => pipe.transform(
    { displayName: '   ' },
    { type: 'body', metatype: UpdateProfileDto, data: '' },
  ))
  await assert.rejects(() => pipe.transform(
    { displayName: 'a'.repeat(33) },
    { type: 'body', metatype: UpdateProfileDto, data: '' },
  ))
})

test('UsersService.updateProfile saves the current user and returns it without a password', async () => {
  const savedUser = {
    id: 'user-1',
    email: 'user@example.com',
    password: 'secret',
    displayName: undefined as string | undefined,
    async save() { return this },
    toJSON() {
      return { id: this.id, email: this.email, displayName: this.displayName }
    },
  }
  const query = { select: async () => savedUser }
  const model = { findById: (id: string) => {
    assert.equal(id, 'user-1')
    return query
  } }
  const service = new UsersService(model as any)

  const result = await service.updateProfile('user-1', { displayName: '林默' }) as any

  assert.equal(savedUser.displayName, '林默')
  assert.deepEqual(result, { id: 'user-1', email: 'user@example.com', displayName: '林默' })
  assert.equal('password' in result, false)
})

test('UsersController.updateProfile derives the target user from the JWT request', async () => {
  const service = {
    updateProfile: async (userId: string, dto: UpdateProfileDto) => ({ userId, ...dto }),
  }
  const controller = new UsersController(service as any)

  const result = await controller.updateProfile(
    { user: { id: 'user-1' } },
    { displayName: '林默' },
  )

  assert.deepEqual(result, { userId: 'user-1', displayName: '林默' })
})

test('AuthService includes displayName in register and login responses', async () => {
  const user = {
    id: 'user-1',
    email: 'user@example.com',
    displayName: '林默',
    createdAt: '2026-08-14',
    updatedAt: '2026-08-14',
  }
  const users = {
    create: async () => user,
    validateUser: async () => user,
  }
  const jwt = { sign: () => 'token' }
  const service = new AuthService(users as any, jwt as any)

  const registered = await service.register({ email: user.email, password: 'password' })
  const loggedIn = await service.login({ email: user.email, password: 'password' })

  assert.equal(registered.user.displayName, '林默')
  assert.equal(loggedIn.user.displayName, '林默')
})
