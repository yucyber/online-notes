import { Module } from '@nestjs/common'
import { RumController } from './rum.controller'
import { RumService } from './rum.service'

@Module({ controllers: [RumController], providers: [RumService] })
export class RumModule { }

