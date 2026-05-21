import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BoardsController } from './boards.controller'
import { BoardsService } from './boards.service'
import { Board, BoardSchema } from './schemas/board.schema'
import { Note, NoteSchema } from '../notes/schemas/note.schema'

@Module({
  imports: [MongooseModule.forFeature([
    { name: Board.name, schema: BoardSchema },
    { name: Note.name, schema: NoteSchema },
  ])],
  controllers: [BoardsController],
  providers: [BoardsService],
})
export class BoardsModule { }
