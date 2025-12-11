import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { MindmapsController } from './mindmaps.controller'
import { MindmapsService } from './mindmaps.service'
import { Mindmap, MindmapSchema } from './schemas/mindmap.schema'

@Module({
  imports: [MongooseModule.forFeature([{ name: Mindmap.name, schema: MindmapSchema }])],
  controllers: [MindmapsController],
  providers: [MindmapsService],
})
export class MindmapsModule {}

