import { redirect } from 'react-router';

export function clientLoader(): Response {
  return redirect('/');
}

export default function CatchAll(): null {
  return null;
}
