import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BoardsController } from './boards.controller'
import { BoardsService } from './boards.service'
import { Board, BoardSchema } from './schemas/board.schema'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { NotesModule } from '../notes/notes.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Board.name, schema: BoardSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
    forwardRef(() => NotesModule),
  ],
  controllers: [BoardsController],
  providers: [BoardsService],
})
export class BoardsModule { }
