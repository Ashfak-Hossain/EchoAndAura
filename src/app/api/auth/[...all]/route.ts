import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

// better-auth's HTTP surface (session refresh, sign-out, etc.). Login and
// sign-out in the admin UI go through server actions instead.
export const { GET, POST } = toNextJsHandler(auth);
