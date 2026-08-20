import { redirect } from 'next/navigation';

/**
 * Root route. Until authentication lands in M1 (session-aware routing),
 * the only meaningful destination is the login screen.
 */
export default function RootPage() {
  redirect('/login');
}
