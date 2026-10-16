import { Redirect } from 'expo-router';

// Приложение открывается на бирже — это главное в нём.
export default function Index() {
  return <Redirect href="/tasks" />;
}
