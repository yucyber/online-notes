import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Comment, CommentSchema } from './schemas/comment.schema'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { CommentsService } from './comments.service'
import { CommentsController, CommentRepliesController } from './comments.controller'
import { AuditModule } from '../audit/audit.module'
import { NotesModule } from '../notes/notes.module'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Comment.name, schema: CommentSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
    AuditModule,
    forwardRef(() => NotesModule),
    UsersModule,
  ],
  controllers: [CommentsController, CommentRepliesController],
  providers: [CommentsService],
})
export class CommentsModule {}
