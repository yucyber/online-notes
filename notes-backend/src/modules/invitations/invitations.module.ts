import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { InvitationsController } from './invitations.controller'
import { InvitationsService } from './invitations.service'
import { Invitation, InvitationSchema } from './schemas/invitation.schema'
import { Note, NoteSchema } from '../notes/schemas/note.schema'
import { AuditModule } from '../audit/audit.module'
import { UsersModule } from '../users/users.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
    AuditModule,
    UsersModule,
    NotificationsModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
