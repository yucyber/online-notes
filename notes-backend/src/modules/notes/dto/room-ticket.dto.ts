export class RoomTicketResponseDto {
  ticket: string;
  role: 'writer' | 'reader';
  expiresIn: number; // 秒
}
