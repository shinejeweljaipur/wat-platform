import { q1, Row } from './db';
import { decryptChannel } from './crypto';

/** Always load channels through these so secrets are decrypted in exactly one place. */
export async function getChannel(id: number): Promise<Row | null> {
  return decryptChannel(await q1('SELECT * FROM channels WHERE id=$1', [id]));
}

export async function getChannelByPhoneNumberId(phoneNumberId: string): Promise<Row | null> {
  return decryptChannel(await q1('SELECT * FROM channels WHERE phone_number_id=$1', [phoneNumberId]));
}
